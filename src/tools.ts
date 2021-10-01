/**
 * This is a secret toolbox for codegen
 */
import fs from "fs"
import {parse, Source} from "graphql"
import {buildModel, buildSchema} from "./gql/schema"
import type {Model} from "./model"


export * from "./util"


export function loadModel(schemaFile: string): Model {
    let src = new Source(
        fs.readFileSync(schemaFile, 'utf-8'),
        schemaFile
    )
    let doc = parse(src)
    let schema = buildSchema(doc)
    return buildModel(schema)
}
