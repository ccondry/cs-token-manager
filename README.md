# Context Service Token Manager

This application will maintain machine account tokens and admin access tokens
for Context Service orgs in a mongo database.

## Install Dependencies
```
npm install
```

## Configure
Create the environment file from the example
```
cp .env.example .env
```
Edit the new .env to point to your mongo db server
```
vim .env
```
Add at least one Context Service org into your mongo database
```
mongo
use <your db name>
db.cs.orgs.insert({username: "myOrgAdminAccount@mydomain.com", password: "myOrgAdminPassword", connectionDataString: "longConnectionDataString"})
```
If you don't have a connection data string, get one by logging into the following
website with your Context Service org admin credentials. The final URL that it
forwards you to will have the connection data string as a URL parameter. Copy it
out of your browser's URL bar for use in the mongo insert.
```
https://ccfs.ciscoccservice.com/v1/authorize?callbackUrl=http%3A%2F%2Ffake&appType=ciscodemo
```

## Run
```
npm start
```

## Install as a service on Ubuntu Linux
Copy the example systemd service file to systemd
```
sudo cp systemd.service /lib/system/systemd/cs-token-manager.service
```

Edit the systemd service file parameters `ExecStart` and `WorkingDirectory` to
point to the location of this project folder (wherever folder you cloned this
repo into).
```
sudo vim /lib/system/systemd/cs-token-manager.service
```

Enable and start the service
```
sudo systemctl enable cs-token-manager
sudo systemctl start cs-token-manager
```

View recent and current running logs of the service
```
journalctl -xef
```
