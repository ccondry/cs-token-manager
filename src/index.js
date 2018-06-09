const cs = require('cs-utils')
const db = require('./mongodb')

// check database for accessToken and refreshToken
async function refreshTokens () {
  try {
    // find all orgs
    const orgs = await db.find('cs.orgs')
    if (orgs === null || orgs.length === 0) {
      // console.log(data)
      throw 'No orgs configured in the database. Please configure at least 1 org with connectionData.'
    } else {
      console.log(`${orgs.length} orgs configured`)
      for (let org of orgs) {
        if (!org.orgId || !org.email || !org.clientId || !org.clientSecret) {
          console.error(`${org.email} orgId ${org.orgId} is not configured correctly. Please configure an email, orgId, clientId, and clientSecret for database ID ${org._id}`)
          continue
        }
        // check for access token
        if (!org.accessToken) {
          console.log(`${org.email} orgId ${org.orgId} does not have an access token. getting new one.`)
          if (!org.adminBearer) {
            // cannot continue without admin bearer token
            console.error(`${org.email} orgId ${org.orgId} does not have an access bearer token. Please configure one.`)
            continue
            // throw new Error(`${org.email} orgId ${org.orgId} adminBearer is required`)
          }
          if (!org.machineBearer) {
            // has no access token and no machine bearer token
            console.log(`${org.email} orgId ${org.orgId} does not have a machine bearer token. getting new one.`)
            if (!org.machineAccountName || !org.machineAccountPassword) {
              console.log(`${org.email} orgId ${org.orgId} does not have a machine account. creating new one.`)
              // generate machine account name for test
              org.machineAccountName = 'cs-token-manager-' + (Math.random() * 1000000 | 0)
              // generate machine account password
              org.machineAccountPassword = cs.utils.generatePassword()
              try {
                // create machine account with new name and password
                const machineAccount = await cs.machineAccount.create({
                  orgId: org.orgId,
                  bearer: org.adminBearer,
                  name: org.machineAccountName,
                  password: org.machineAccountPassword
                })
                org.machineAccountId = machineAccount.id
                // authorize machine account
                console.log(`${org.email} orgId ${org.orgId} machine account id ${org.machineAccountId} created. authorizing machine account for Context Service...`)
              } catch (e) {
                console.error(`${org.email} orgId ${org.orgId} - failed to create machine account ${org.machineAccountName}`, e.message)
                continue
              }
              try {
                await cs.machineAccount.authorizeToCs({
                  orgId: org.orgId,
                  bearer: org.adminBearer,
                  machineAccountId: org.machineAccountId
                })
              } catch (e) {
                console.error(`${org.email} orgId ${org.orgId} machine account id ${org.machineAccountId} failed to authorize for Context Service.`, e.message)
                continue
              }
            }
            console.log(`${org.email} orgId ${org.orgId} machine account authorized for Context Service. getting bearer token...`)
            try {
              const machineBearer = await cs.machineAccount.getBearerToken({
                name: org.machineAccountName,
                password: org.machineAccountPassword,
                orgId: org.orgId
              })
              org.machineBearer = machineBearer.BearerToken
              console.log(`${org.email} orgId ${org.orgId} got new machine bearer token.`)
            } catch (e) {
              console.error(`${org.email} orgId ${org.orgId} failed get new machine bearer token:`, e.message)
              continue
            }
          }
          try {
            // get new access token
            // const connectionData = cs.utils.decodeConnectionData(org.connectionData)
            // const credentials = cs.utils.getCredentials(connectionData, org.labMode)
            org.accessToken = await cs.machineAccount.getAccessToken({
              clientId: org.clientId,
              clientSecret: org.clientSecret,
              bearerToken: org.machineBearer
            })
            console.log(`${org.email} with orgId ${org.orgId} got new machine account access token.`)
          } catch (e) {
            console.error(`${org.email} with orgId ${org.orgId} error getting new machine account access token`, e)
          }
        }
        // have org.accessToken now

        // refresh the accessToken
        try {
          console.log(`${org.email} with orgId ${org.orgId} refreshing token...`)
          org.accessToken = await cs.machineAccount.refreshAccessToken({
            clientId: org.clientId,
            clientSecret: org.clientSecret,
            refreshToken: org.accessToken.refresh_token
          })
          const expiryDays = refreshedToken.refresh_token_expires_in / 60 * 60 * 24
          console.log(`${org.email} with orgId ${org.orgId} token refreshed. Refresh token ${refreshedToken.refresh_token} expires in ${expiryDays}.`)
        } catch (e) {
          console.log(`${org.email} with orgId ${org.orgId} token refresh failed.`, e.message)
        }

        // update org in database
        try {
          console.log(`${org.email} with orgId ${org.orgId} - updating info in database...`)
          await db.upsert('cs.orgs', {orgId: org.orgId}, org)
          console.log(`${org.email} with orgId ${org.orgId} info was updated in database.`)
        } catch (e) {
          console.error(`${org.email} with orgId ${org.orgId} info failed to be updated in database`, e)
        }
      }
      // finished iterating over database entries
    }
  } catch (error) {
    // error during init
    throw error
  }
}

// start off by refreshing tokens
refreshTokens()
.then(rsp => {
  // set up 5-minute interval to refresh tokens again
  setInterval(function() {
    console.log('refresh timer is up! refreshing all tokens...')
    refreshTokens().catch(e => console.error(e))
    // }, 2 * 60 * 60 * 1000)
  }, process.env.REFRESH_INTERVAL * 60 * 1000)
})
.catch(e => console.error(e))


// setTimeout(function() {
//   console.log('hello world!');
// }, 5000);
