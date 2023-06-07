#!/bin/sh

str=null
FILENAME=stack.json

if [ -f "${FILENAME}" ];then
    if [ -s "${FILENAME}" ];then
        CONTENTS=`cat ${FILENAME} | sed -e 's/^[[:space:]]*//'`
        if [ $CONTENTS = "null" ]; then
            echo "${FILENAME} is null"
            exit 1
        else 
            echo "${FILENAME} exists and not empty"
        fi
    else
        echo "${FILENAME} exists but empty"
    fi
else
    echo "${FILENAME} does exists"
fi