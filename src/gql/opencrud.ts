import {gql} from "apollo-server"
import assert from "assert"
import {DocumentNode, GraphQLEnumType, GraphQLSchema, print} from "graphql"
import {Entity, Enum, FTS_Query, Interface, JsonObject, Prop, Union} from "../model"
import {getOrderByMapping} from "../orderBy"
import {scalars_list} from "../scalars"
import {lowerCaseFirst, Output, pluralize, upperCaseFirst} from "../util"
import {getModel} from "./schema"


export function generateOpenCrudQueries(schema: GraphQLSchema): string {
    let out = new Output()
    let model = getModel(schema)

    generatePageInfoType()

    for (let name in model) {
        let item = model[name]
        switch(item.kind) {
            case 'entity':
                generateOrderByInput(name)
                generateWhereUniqueInput(name)
                generateWhereInput(name, item)
                generateObjectType(name, item)
                generateEntityConnection(name)
                break
            case 'object':
                if (hasFilters(item)) {
                    generateWhereInput(name, item)
                }
                generateObjectType(name, item)
                break
            case 'interface':
                generateObjectType(name, item)
                break
            case 'union':
                generateUnionWhereInput(name, item)
                generateUnionType(name, item)
                break
            case 'enum':
                generateEnumType(name, item)
                break
            case 'fts':
                generateFtsTypes(name, item)
                break
        }
    }

    out.block('type Query', () => {
        for (let name in model) {
            let item = model[name]
            if (item.kind == 'entity') {
                out.line(`${lowerCaseFirst(name)}ById(id: ID!): ${name}`)
                out.line(`${lowerCaseFirst(name)}ByUniqueInput(where: ${name}WhereUniqueInput!): ${name} @deprecated(reason: "Use \`${lowerCaseFirst(name)}ById\`")`)
                out.line(`${lowerCaseFirst(pluralize(name))}${manyArguments(name)}: [${name}!]!`)
                out.line(`${lowerCaseFirst(pluralize(name))}Connection${connectionArguments(name)}: ${name}Connection!`)
            }
            if (item.kind == 'fts') {
                generateFtsQuery(name, item)
            }
        }
    })

    function generateObjectType(name: string, object: Entity | JsonObject | Interface): void {
        let head: string
        if (object.kind == 'interface') {
            head = `interface ${name}`
        } else {
            head = `type ${name}`
            if (object.interfaces?.length) {
                head += ` implements ${object.interfaces.join(' & ')}`
            }
        }
        generateDescription(object.description)
        out.block(head, () => {
            for (let key in object.properties) {
                let prop = object.properties[key]
                let gqlType = renderPropType(prop)
                generateDescription(prop.description)
                if (prop.type.kind == 'list-relation') {
                    out.line(`${key}${manyArguments(prop.type.entity)}: ${gqlType}`)
                } else {
                    out.line(`${key}: ${gqlType}`)
                }
            }
        })
        out.line()
    }

    function renderPropType(prop: Prop): string {
        switch(prop.type.kind) {
            case "list":
                return `[${renderPropType(prop.type.item)}]${prop.nullable ? '' : '!'}`
            case 'fk':
                return `${prop.type.foreignEntity}${prop.nullable ? '' : '!'}`
            case "list-relation":
                return `[${prop.type.entity}!]!`
            default:
                return prop.type.name + (prop.nullable ? '' : '!')
        }
    }

    function manyArguments(entityName: string): string {
        return `(where: ${entityName}WhereInput orderBy: [${entityName}OrderByInput] offset: Int limit: Int)`
    }

    function connectionArguments(entityName: string): string {
        return `(orderBy: [${entityName}OrderByInput!]! after: String first: Int where: ${entityName}WhereInput)`
    }

    function generateOrderByInput(entityName: string): void {
        out.block(`enum ${entityName}OrderByInput`, () => {
            let mapping = getOrderByMapping(model, entityName)
            for (let key of mapping.keys()) {
                out.line(key)
            }
        })
        out.line()
    }

    function generateWhereUniqueInput(entityName: string): void {
        out.block(`input ${entityName}WhereUniqueInput`, () => {
            out.line('id: ID!')
        })
    }

    function generateWhereInput(name: string, object: Entity | JsonObject): void {
        out.block(`input ${name}WhereInput`, () => {
            generatePropsFilters(object.properties)
            if (object.kind == 'entity') {
                out.line(`AND: [${name}WhereInput!]`)
                out.line(`OR: [${name}WhereInput!]`)
            }
        })
        out.line()
    }

    function generatePropsFilters(props: Record<string, Prop>): void {
        for (let key in props) {
            let prop = props[key]
            switch(prop.type.kind) {
                case 'scalar':
                case 'enum':
                    generateScalarFilters(key, prop.type.name)
                    break
                case 'object':
                    if (hasFilters(getObject(prop.type.name))) {
                        out.line(`${key}: ${prop.type.name}WhereInput`)
                    }
                    break
                case 'union':
                    out.line(`${key}: ${prop.type.name}WhereInput`)
                    break
                case 'fk':
                    out.line(`${key}: ${prop.type.foreignEntity}WhereInput`)
                    break
                case 'list-relation':
                    out.line(`${key}_every: ${prop.type.entity}WhereInput`)
                    out.line(`${key}_some: ${prop.type.entity}WhereInput`)
                    out.line(`${key}_none: ${prop.type.entity}WhereInput`)
                    break
            }
        }
    }

    function hasFilters(obj: JsonObject): boolean {
        for (let key in obj.properties) {
            let propType = obj.properties[key].type
            switch(propType.kind) {
                case 'scalar':
                case 'enum':
                case 'union':
                    return true
                case 'object':
                    if (hasFilters(getObject(propType.name))) {
                        return true
                    }
            }
        }
        return false
    }

    function getObject(name: string): JsonObject {
        let obj = model[name]
        assert(obj.kind == 'object')
        return obj
    }

    function generateUnionWhereInput(name: string, union: Union): void {
        out.block(`input ${name}WhereInput`, () => {
            // TODO: unify and use enum
            out.line('isTypeOf: String')
            out.line('isTypeOf_not: String')
            out.line('isTypeOf_in: [String!]')
            out.line('isTypeOf_not_in: [String!]')

            let props: Record<string, Prop> = {}
            union.variants.forEach(variant => {
                let obj = getObject(variant)
                Object.assign(props, obj.properties)
            })

            generatePropsFilters(props)
        })
    }

    function generateScalarFilters(fieldName: string, graphqlType: string): void {
        out.line(`${fieldName}: ${graphqlType}`)
        out.line(`${fieldName}_not: ${graphqlType}`)

        switch(graphqlType) {
            case 'ID':
            case 'String':
            case 'Int':
            case 'Float':
            case 'DateTime':
            case 'BigInt':
                out.line(`${fieldName}_gt: ${graphqlType}`)
                out.line(`${fieldName}_gte: ${graphqlType}`)
                out.line(`${fieldName}_lt: ${graphqlType}`)
                out.line(`${fieldName}_lte: ${graphqlType}`)
                out.line(`${fieldName}_in: [${graphqlType}!]`)
                out.line(`${fieldName}_not_in: [${graphqlType}!]`)
                break
        }

        if (graphqlType == 'String' || graphqlType == 'ID') {
            out.line(`${fieldName}_contains: ${graphqlType}`)
            out.line(`${fieldName}_not_contains: ${graphqlType}`)
            out.line(`${fieldName}_starts_with: ${graphqlType}`)
            out.line(`${fieldName}_not_starts_with: ${graphqlType}`)
            out.line(`${fieldName}_ends_with: ${graphqlType}`)
            out.line(`${fieldName}_not_ends_with: ${graphqlType}`)
        }

        if (schema.getType(graphqlType) instanceof GraphQLEnumType) {
            out.line(`${fieldName}_in: [${graphqlType}!]`)
            out.line(`${fieldName}_not_in: [${graphqlType}!]`)
        }
    }

    function generateUnionType(name: string, union: Union) {
        generateDescription(union.description)
        out.line(`union ${name} = ${union.variants.join(' | ')}`)
        out.line()
    }

    function generateEnumType(name: string, e: Enum): void {
        generateDescription(e.description)
        out.block(`enum ${name}`, () => {
            for (let key in e.values) {
                out.line(key)
            }
        })
    }

    function generatePageInfoType(): void {
        out.block(`type PageInfo`, () => {
            out.line('hasNextPage: Boolean!')
            out.line('hasPreviousPage: Boolean!')
            out.line('startCursor: String!')
            out.line('endCursor: String!')
        })
        out.line()
    }

    function generateEntityConnection(name: string): void {
        out.block(`type ${name}Edge`, () => {
            out.line(`node: ${name}!`)
            out.line(`cursor: String!`)
        })
        out.line()
        out.block(`type ${name}Connection`, () => {
            out.line(`edges: [${name}Edge!]!`)
            out.line(`pageInfo: PageInfo!`)
            out.line(`totalCount: Int!`)
        })
        out.line()
    }

    function generateFtsTypes(name: string, query: FTS_Query): void {
        let itemType = upperCaseFirst(name) + '_Item'
        out.line(`union ${itemType} = ${query.sources.map(s => s.entity).join(' | ')}`)
        out.line()
        out.block(`type ${upperCaseFirst(name)}Output`, () => {
            out.line(`item: ${itemType}!`)
            out.line(`rank: Float!`)
            out.line(`highlight: String!`)
        })
        out.line()
    }

    function generateFtsQuery(name: string, query: FTS_Query): void {
        let where = query.sources.map(src => {
            return `where${src.entity}: ${src.entity}WhereInput`
        })
        out.line(`${name}(text: String! ${where.join(' ')} limit: Int offset: Int): [${upperCaseFirst(name)}Output!]!`)
    }

    function generateDescription(description?: string): void {
        if (description) {
            out.line(print({
                kind: 'StringValue',
                value: description
            }))
        }
    }

    return out.toString()
}


export function buildServerSchema(schema: GraphQLSchema): DocumentNode {
    let scalars = scalars_list.map(name => 'scalar ' + name).join('\n')
    let queries = generateOpenCrudQueries(schema)
    return gql(scalars  + '\n\n' + queries)
}
