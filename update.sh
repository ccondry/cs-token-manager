#!/bin/sh
# this file is meant to be run from cron to update the local git branch with the
# associated upstream branch, then restart the service

# fetch changes from origin
git fetch
# get the number of changes between local and remote (current branch)
CHANGES=$(git rev-list HEAD...@{u} --count)

# check if changes need to be pulled in
if [ $CHANGES = "0" ]; then
  # no changes - exit after this
  echo "git repo is current"
else
  # there are repo updates in remote
  echo "git repo is not current. updating..."
  git pull
  # check if git pull worked
  if [ $? -eq 0 ]; then
    echo "running npm install"
    npm i
    if [ $? -eq 0 ]; then
      echo "restarting systemd service..."
      sudo /bin/systemctl restart cs-token-manager.service
    else
      echo "npm install failed"
    fi
  else
    echo "failed to pull repo"
    echo "trying to remove package-lock.json and try on next iteration"
    rm package-lock.json
  fi
fi
