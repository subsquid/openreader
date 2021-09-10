import {gql} from "apollo-server"
import {DocumentNode, GraphQLEnumType, GraphQLSchema} from "graphql"
import {Entity, Relation} from "../model"
import {scalars_list} from "../scalars"
import {lowerCaseFirst, Output, pluralize} from "../util"
import {getModel} from "./schema"


export function generateOpenCrudQueries(schema: GraphQLSchema): string {
    let out = new Output()
    let model = getModel(schema)

    for (let name in model) {
        // generateOrderByInput(name, model[name])
        generateWhereInput(name, model[name])
        generateModelType(name, model[name])
    }

    out.block('type Query', () => {
        for (let name in model) {
            out.line(`${lowerCaseFirst(pluralize(name))}${manyArguments(name)}: [${name}!]!`)
        }
    })

    function generateModelType(name: string, entity: Entity): void {
        out.block(`type ${name}`, () => {
            for (let key in entity.columns) {
                let col = entity.columns[key]
                out.line(`${key}: ${col.graphqlType}${col.nullable ? '' : '!'}`)
            }
            for (let key in entity.relations) {
                let rel = entity.relations[key]
                switch(rel.type) {
                    case 'FK':
                        out.line(`${key}: ${rel.foreignEntity}${rel.nullable ? '' : '!'}`)
                        break
                    case 'LIST':
                        out.line(`${key}${manyArguments(rel.entity)}: [${rel.entity}!]!`)
                        break
                }
            }
        })
        out.line()
    }

    function manyArguments(relatedEntityName: string): string {
        return `(where: ${relatedEntityName}WhereInput offset: Int limit: Int)`
    }

    function generateOrderByInput(name: string, entity: Entity): void {
        out.block(`enum ${name}OrderByInput`, () => {
            for (let col in entity.columns) {
                out.line(`${col}_ASC`)
                out.line(`${col}_DESC`)
            }
        })
        out.line()
    }

    function generateWhereInput(name: string, entity: Entity): void {
        out.block(`input ${name}WhereInput`, () => {
            for (let key in entity.columns) {
                generateScalarFilters(key, entity.columns[key].graphqlType)
            }
            for (let key in entity.relations) {
                generateRelationFilters(key, entity.relations[key])
            }
            out.line(`AND: [${name}WhereInput!]`)
            out.line(`OR: [${name}WhereInput!]`)
        })
        out.line()
    }

    function generateScalarFilters(fieldName: string, graphqlType: string): void {
        out.line(`${fieldName}: ${graphqlType}`)
        out.line(`${fieldName}_not: ${graphqlType}`)

        switch(graphqlType) {
            case 'ID':
            case 'String':
            case 'DateTime':
            case 'Int':
            case 'Float':
            case 'BigInt':
            case 'BigDecimal':
                out.line(`${fieldName}_gt: ${graphqlType}`)
                out.line(`${fieldName}_gte: ${graphqlType}`)
                out.line(`${fieldName}_lt: ${graphqlType}`)
                out.line(`${fieldName}_lte: ${graphqlType}`)
                // out.line(`${fieldName}_in: [${graphqlType}!]`)
                // out.line(`${fieldName}_not_in: [${graphqlType}!]`)
                break
        }

        if (graphqlType == 'String' || graphqlType == 'ID') {
            // out.line(`${fieldName}_contains: ${graphqlType}`)
            // out.line(`${fieldName}_not_contains: ${graphqlType}`)
            // out.line(`${fieldName}_starts_with: ${graphqlType}`)
            // out.line(`${fieldName}_not_starts_with: ${graphqlType}`)
            // out.line(`${fieldName}_ends_with: ${graphqlType}`)
            // out.line(`${fieldName}_not_ends_with: ${graphqlType}`)
        }

        if (schema.getType(graphqlType) instanceof GraphQLEnumType) {
            // out.line(`${fieldName}_in: [${graphqlType}!]`)
            // out.line(`${fieldName}_not_in: [${graphqlType}!]`)
        }
    }

    function generateRelationFilters(fieldName: string, rel: Relation) {
        switch(rel.type) {
            case 'FK':
                out.line(`${fieldName}: ${rel.foreignEntity}WhereInput`)
                break
            case 'LIST':
                out.line(`${fieldName}_every: ${rel.entity}WhereInput`)
                out.line(`${fieldName}_some: ${rel.entity}WhereInput`)
                out.line(`${fieldName}_none: ${rel.entity}WhereInput`)
                break
        }
    }

    return out.toString()
}


export function buildServerSchema(schema: GraphQLSchema): DocumentNode {
    let queries = generateOpenCrudQueries(schema)
    return gql(
        scalars_list.map(name => 'scalar ' + name).join('\n') + '\n\n' + queries
    )
}
