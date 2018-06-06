const auth = require('cs-utils').Auth
const db = require('./mongodb')

async function init () {
  const orgs = await db.find('cs.orgs')
  // iterate over orgs
  for (let org of orgs) {
    // get access token
    const accessToken = await auth.getAccessToken(org.connectionData, true, true)
    // refresh access token
    const refreshedToken = await auth.refreshAccessToken(org.connectionData, true, accessToken)
    // store new token in db
    await db.update('cs.orgs', {connectionData: org.connectionData}, refreshedToken, 'accessToken')
  }
  console.log('complete')
}

init().catch(e => console.log(e))
