#!/usr/bin/env node

import {Pool, PoolConfig} from "pg"
import {Server} from "./server"
import {loadModel} from "./tools"


function main() {
    let args = process.argv.slice(2)

    if (args.indexOf('--help') >= 0) {
        help()
        process.exit(1)
    }

    if (args.length != 1) {
        help()
        process.exit(1)
    }

    let model = loadModel(args[0])
    let db = new Pool(readDbConfig())
    let port = process.env.GRAPHQL_SERVER_PORT || 3000

    new Server({model, db}).listen(port).then(
        () => {
            console.log('OpenReader is listening on port ' + port)
        },
        err => {
            console.error(err)
            process.exit(1)
        }
    )
}


export function readDbConfig(): PoolConfig {
    let db: PoolConfig = {}
    if (process.env.DB_HOST) {
        db.host = process.env.DB_HOST
    }
    if (process.env.DB_PORT) {
        db.port = parseInt(process.env.DB_PORT)
    }
    if (process.env.DB_NAME) {
        db.database = process.env.DB_NAME
    }
    if (process.env.DB_USER) {
        db.user = process.env.DB_USER
    }
    if (process.env.DB_PASS) {
        db.password = process.env.DB_PASS
    }
    return db
}


function help() {
    console.error(`
Usage:  openreader SCHEMA

OpenCRUD compatible GraphQL server.

Can be configured using hydra environment variables:

    DB_NAME
    DB_USER
    DB_PASS
    DB_HOST
    DB_PORT
    GRAPHQL_SERVER_PORT
`)
}


if (require.main === module) {
    main()
}
