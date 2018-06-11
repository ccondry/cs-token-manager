const cs = require('cs-utils')
const db = require('./mongodb')

// main loop - start off by refreshing tokens
refreshTokens()
.then(rsp => {
  // set up interval to periodically refresh access tokens
  setInterval(function() {
    console.log('refresh timer is up! refreshing all tokens...')
    // refresh tokens again
    refreshTokens().catch(e => console.error(e))
    // set interval using env var, in minutes
  }, process.env.REFRESH_INTERVAL * 60 * 1000)
})
.catch(e => console.error(e))

// check database for accessToken and refreshToken
async function refreshTokens () {
  let orgs
  try {
    // find all orgs
    orgs = await db.find('cs.orgs')
  } catch (error) {
    // error finding orgs
    throw error
  }
  // validate that we found some orgs
  if (!orgs || orgs === null || orgs.length === 0) {
    // console.log(data)
    throw 'No orgs configured in the database. Please configure at least 1 org with connectionData.'
  }
  // found orgs
  console.log(`${orgs.length} orgs configured`)
  // iterate over the orgs
  for (let org of orgs) {
    // validate that this db entry has been configured with org details that we need
    if (!org.username || !org.password) {
      console.error(`org is not configured correctly. Please configure a username and password for database ID ${org._id}`)
      // move on to next item in the iteration
      continue
    }
    if (!org.id || !org.clientId || !org.clientSecret) {
      // need clientId and clientSecret - see if we have connectionData
      console.log(`${org.username} does not have orgId, clientId, and clientSecret. getting them...`)
      if (!org.connectionData) {
        if (!org.connectionDataString) {
          console.error(`${org.username} is not configured correctly. Please configure a connectionDataString for database ID ${org._id}`)
          // move on to next item in the iteration
          continue
        }
        // decode connection data
        console.error(`${org.username} decoding connection data string...`)
        org.connectionData = cs.utils.decodeConnectionData(org.connectionDataString)
      }
      const credentials = cs.utils.getCredentials(org.connectionData, org.labMode)
      org.id = credentials.orgId
      org.clientId = credentials.clientId
      org.clientSecret = credentials.clientSecret
      console.error(`${org.username} orgId ${org.id} is now configured for getting access tokens.`)
    }
    // check for access token
    if (!org.accessToken) {
      console.log(`${org.username} orgId ${org.id} does not have an access token. getting new one.`)
      if (!org.adminBearer) {
        try {
          const adminAccesstoken = await cs.org.getAdminAccessToken({
            username: org.username,
            password: org.password,
            orgId: org.id,
            clientId: org.clientId,
            clientSecret: org.clientSecret,
          })
          org.adminBearer = adminAccesstoken.access_token
        } catch (e) {
          console.error('failed to get admin access token', e.message)
          continue
        }
      }
      if (!org.machineBearer) {
        // has no access token and no machine bearer token
        console.log(`${org.username} orgId ${org.id} does not have a machine bearer token. getting new one.`)
        if (!org.machineAccountName || !org.machineAccountPassword) {
          console.log(`${org.username} orgId ${org.id} does not have a machine account. creating new one.`)
          // generate machine account name for test
          org.machineAccountName = 'cs-token-manager-' + (Math.random() * 1000000 | 0)
          // generate machine account password
          org.machineAccountPassword = cs.utils.generatePassword()
          try {
            // create machine account with new name and password
            const machineAccount = await cs.machineAccount.create({
              orgId: org.id,
              bearer: org.adminBearer,
              name: org.machineAccountName,
              password: org.machineAccountPassword
            })
            org.machineAccountId = machineAccount.id
            // authorize machine account
            console.log(`${org.username} orgId ${org.id} machine account id ${org.machineAccountId} created. authorizing machine account for Context Service...`)
          } catch (e) {
            console.error(`${org.username} orgId ${org.id} - failed to create machine account ${org.machineAccountName}`, e.message)
            // move on to next item in the iteration
            continue
          }
          try {
            await cs.machineAccount.authorizeToCs({
              orgId: org.id,
              bearer: org.adminBearer,
              machineAccountId: org.machineAccountId
            })
          } catch (e) {
            console.error(`${org.username} orgId ${org.id} machine account id ${org.machineAccountId} failed to authorize for Context Service.`, e.message)
            // move on to next item in the iteration
            continue
          }
        }
        console.log(`${org.username} orgId ${org.id} machine account authorized for Context Service. getting bearer token...`)
        try {
          const machineBearer = await cs.machineAccount.getBearerToken({
            name: org.machineAccountName,
            password: org.machineAccountPassword,
            orgId: org.id
          })
          org.machineBearer = machineBearer.BearerToken
          console.log(`${org.username} orgId ${org.id} got new machine bearer token.`)
        } catch (e) {
          console.error(`${org.username} orgId ${org.id} failed get new machine bearer token:`, e.message)
          // move on to next item in the iteration
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
        console.log(`${org.username} with orgId ${org.id} got new machine account access token.`)
      } catch (e) {
        console.error(`${org.username} with orgId ${org.id} error getting new machine account access token`, e)
        // move on to next item in the iteration
        continue
      }
    }
    // have org.accessToken now

    // refresh the accessToken
    try {
      console.log(`${org.username} with orgId ${org.id} refreshing token...`)
      org.accessToken = await cs.machineAccount.refreshAccessToken({
        clientId: org.clientId,
        clientSecret: org.clientSecret,
        refreshToken: org.accessToken.refresh_token
      })
      // get expiry days with 2 decimal places
      const expiryDays = (org.accessToken.refresh_token_expires_in / (60 * 60 * 24)).toFixed(2)
      console.log(`${org.username} with orgId ${org.id} token refreshed. Refresh token ${org.accessToken.refresh_token} expires in ${expiryDays} days.`)
    } catch (e) {
      console.log(`${org.username} with orgId ${org.id} token refresh failed.`, e.message)
      // move on to next item in the iteration
      continue
    }

    // update org in database
    try {
      console.log(`${org.username} with orgId ${org.id} - updating info in database...`)
      await db.upsert('cs.orgs', {_id: org._id}, org)
      console.log(`${org.username} with orgId ${org.id} info was updated in database.`)
    } catch (e) {
      console.error(`${org.username} with orgId ${org.id} info failed to be updated in database`, e)
      // move on to next item in the iteration
      continue
    }
    // end of the for-loop for this org
  }
  // finished for-loop over orgs
}
