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

// format expiresIn seconds into days
function getExpiryDays (accessToken) {
  return (accessToken.refresh_token_expires_in / (60 * 60 * 24)).toFixed(2)
}

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
    try {
      await processOrg(org)
      await updateDatabase(org)
    } catch (error) {
      // error finding orgs
      continue
    }
  }
  // finished for-loop over orgs
}

async function updateDatabase (org) {
  // update org in database
  try {
    console.log(`${org.username} with orgId ${org.id} - updating info in database...`)
    await db.upsert('cs.orgs', {_id: org._id}, org)
    console.log(`${org.username} with orgId ${org.id} info was updated in database.`)
  } catch (e) {
    console.error(`${org.username} with orgId ${org.id} info failed to be updated in database`, e.message)
    // move on to next item in the iteration
    return
  }
}

async function processOrg (org) {
    // validate that this db entry has been configured with org details that we need
    if (!org.username || !org.password) {
      console.error(`org is not configured correctly. Please configure a username and password for database ID ${org._id}`)
      // move on to next item in the iteration
      return
    }
    if (!org.id || !org.clientId || !org.clientSecret) {
      // need clientId and clientSecret - see if we have connectionData
      console.log(`${org.username} does not have orgId, clientId, and clientSecret. getting them...`)
      if (!org.connectionData) {
        if (!org.connectionDataString) {
          console.error(`${org.username} is not configured correctly. Please configure a connectionDataString for database ID ${org._id}`)
          // move on to next item in the iteration
          return
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

    // check for admin access token
    if (!org.adminAccessToken) {
      try {
        // get an admin access token
        org.adminAccessToken = await cs.org.getAdminAccessToken({
          username: org.username,
          password: org.password,
          orgId: org.id,
          clientId: org.clientId,
          clientSecret: org.clientSecret,
        })
      } catch (e) {
        console.error('failed to get admin access token', e.message)
        return
      }
    }

    // check for access token
    if (!org.accessToken) {
      console.log(`${org.username} orgId ${org.id} does not have an access token. getting new one.`)
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
              bearer: org.adminAccessToken.access_token,
              name: org.machineAccountName,
              password: org.machineAccountPassword
            })
            org.machineAccountId = machineAccount.id
            // authorize machine account
            console.log(`${org.username} orgId ${org.id} machine account id ${org.machineAccountId} created. authorizing machine account for Context Service...`)
          } catch (e) {
            console.error(`${org.username} orgId ${org.id} - failed to create machine account ${org.machineAccountName}`, e.message)
            // move on to next item in the iteration
            return
          }
          try {
            await cs.machineAccount.authorizeToCs({
              orgId: org.id,
              bearer: org.adminAccessToken.access_token,
              machineAccountId: org.machineAccountId
            })
          } catch (e) {
            console.error(`${org.username} orgId ${org.id} machine account id ${org.machineAccountId} failed to authorize for Context Service.`, e.message)
            // move on to next item in the iteration
            return
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
          return
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
        console.error(`${org.username} with orgId ${org.id} error getting new machine account access token`, e.message)
        // check if it was a 400 error of invalid grant
        if (e.statusCode === 400) {
          // this means we need to renew the machine account
          // remove the old machine bearer, and re-run this function
          delete org.machineBearer
          processOrg(org)
        } else {
          // move on to next item in the iteration
          return
        }
      }
    }
    // have org.accessToken now

    // refresh the accessToken
    try {
      console.log(`${org.username} with orgId ${org.id} refreshing machine access token...`)
      // refresh machine access token
      org.accessToken = await cs.machineAccount.refreshAccessToken({
        clientId: org.clientId,
        clientSecret: org.clientSecret,
        refreshToken: org.accessToken.refresh_token
      })
      // get expiry days with 2 decimal places
      console.log(`${org.username} with orgId ${org.id} machine access token refreshed. Refresh token ${org.accessToken.refresh_token} expires in ${getExpiryDays(org.accessToken)} days.`)
    } catch (e) {
      console.log(`${org.username} with orgId ${org.id} machine access token refresh failed.`, e.message)
      // move on to next item in the iteration
      return
    }

    // refresh the adminAccessToken
    try {
      console.log(`${org.username} with orgId ${org.id} refreshing admin access token...`)
      // refresh admin access token
      org.adminAccessToken = await cs.machineAccount.refreshAccessToken({
        clientId: org.clientId,
        clientSecret: org.clientSecret,
        refreshToken: org.adminAccessToken.refresh_token
      })
      // get expiry days with 2 decimal places
      console.log(`${org.username} with orgId ${org.id} admin access token refreshed. Refresh token ${org.adminAccessToken.refresh_token} expires in ${getExpiryDays(org.adminAccessToken)} days.`)
    } catch (e) {
      console.log(`${org.username} with orgId ${org.id} admin access token refresh failed.`, e.message)
      // move on to next item in the iteration
      return
    }
    // end of the for-loop for this org
}
