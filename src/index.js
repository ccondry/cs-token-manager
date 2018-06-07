const cs = require('cs-utils')
const db = require('./mongodb')

// const snooze = ms => new Promise(resolve => setTimeout(resolve, ms));
//
// const example = async () => {
//   console.log('About to snooze without halting the event loop...');
//   await snooze(1000);
//   console.log('done!');
// };

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
        // console.log('org', org)
        if (org.accessToken) {
          // has accessToken
          console.log(`${org.email} org has accessToken already`)
        } else {
          console.log(`${org.email} org does not have an accessToken. getting new one.`)
          try {
            // get new access token
            const connectionData = cs.utils.decodeConnectionData(org.connectionData)
            const credentials = cs.utils.getCredentials(connectionData, org.labMode)
            org.accessToken = await cs.tokens.getAccessToken(credentials, connectionData.identityBrokerUrl, true)
            org.orgId = credentials.orgId
            console.log(`${org.email} org got new accessToken. adding to database.`)
          }
          catch (e) {
            console.error('error getting new access token', e)
          }
          try {
            // add access token to database
            await db.update('cs.orgs', {connectionData: org.connectionData}, org.accessToken, 'accessToken')
            // set orgId in database
            await db.update('cs.orgs', {connectionData: org.connectionData}, org.orgId, 'orgId')
            console.log(`${org.email} org - successfully added new accessToken to database.`)
          }
          catch (e) {
            console.error('error adding new access token to the database', e)
          }
        }
        // have org.accessToken now
        // refresh the accessToken
        try {
          console.error(`${org.email} refreshing token`)
          // console.error(`org.connectionData ${org.connectionData}`)
          // console.error(`org.labMode ${org.labMode}`)
          // console.error(`org.accessToken ${org.accessToken}`)
          const refreshedToken = await cs.tokens.refreshAccessToken(org.connectionData, org.labMode, org.accessToken)
          console.log(`${org.email} refreshed access token. refresh_token:`, refreshedToken.refresh_token)
          // update database with refreshed token
          await db.update('cs.orgs', {connectionData: org.connectionData}, refreshedToken, 'accessToken')
          // set orgId in database
          const connectionData = cs.utils.decodeConnectionData(org.connectionData)
          const credentials = cs.utils.getCredentials(connectionData, org.labMode)
          org.orgId = credentials.orgId
          await db.update('cs.orgs', {connectionData: org.connectionData}, org.orgId, 'orgId')
          console.log(`${org.email} saved refreshed token to database`)
        } catch (e) {
          console.error(`${org.email} connectionData may have expired: ` + e.message)
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
  }, 2 * 60 * 60 * 1000)
})
.catch(e => console.error(e))


// setTimeout(function() {
//   console.log('hello world!');
// }, 5000);
