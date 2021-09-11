#!/usr/bin/env node

import * as fs from "fs"
import {parse, Source, validateSchema} from "graphql"
import {PoolConfig} from "pg"
import {buildSchema} from "./gql/schema"
import {createServer} from "./server"


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

    let schema = buildSchema(
        readSchemaDocument(args[0])
    )

    let errors = validateSchema(schema).filter(err => !/query root/i.test(err.message))
    if (errors.length > 0) {
        errors.forEach(err => console.log(err))
        process.exit(1)
    }

    let db = readDbConfig()

    let server = createServer({
        schema,
        db
    })

    let port = process.env.GRAPHQL_SERVER_PORT || 3000

    server.listen(port).then(
        () => {
            console.log('OpenReader is listening on port ' + port)
        },
        err => {
            console.error(err)
            process.exit(1)
        }
    )
}


function readDbConfig(): PoolConfig {
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


function readSchemaDocument(file: string) {
    let src = new Source(
        fs.readFileSync(file, 'utf-8'),
        file
    )
    return parse(src)
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
