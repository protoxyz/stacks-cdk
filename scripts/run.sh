#!/bin/sh

str=null
FILENAME=stack.json

if [ -f "${FILENAME}" ]; then
    if [ -s "${FILENAME}" ]; then
        CONTENTS=`cat ${FILENAME} | sed -e 's/^[[:space:]]*//'`
        if [[ "$CONTENTS" != "null" ]]; then
            echo "${FILENAME} exists and not empty"
            
            echo "Installing dependencies"
            npm install
            echo "Deploying CDK"

            STACK_ID=$STACK_ID FIRST_DEPLOY=$FIRST_DEPLOY npx cdk deploy
        else 
            echo "${FILENAME} is null"
            exit 1
        fi
    else
        echo "${FILENAME} exists but empty"
    fi
else
    echo "${FILENAME} does exists"
fi