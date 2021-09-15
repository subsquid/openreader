import {gql} from "apollo-server"
import assert from "assert"
import {DocumentNode, GraphQLEnumType, GraphQLSchema} from "graphql"
import {Entity, Enum, JsonObject, Prop, PropType, Relation, Union} from "../model"
import {scalars_list} from "../scalars"
import {lowerCaseFirst, Output, pluralize} from "../util"
import {getModel} from "./schema"


export function generateOpenCrudQueries(schema: GraphQLSchema): string {
    let out = new Output()
    let model = getModel(schema)

    for (let name in model) {
        let item = model[name]
        switch(item.kind) {
            case 'entity':
                // generateOrderByInput(name, model[name])
                generateWhereInput(name, item)
                generateObjectType(name, item)
                break
            case 'object':
                if (hasFilters(item)) {
                    generateWhereInput(name, item)
                }
                generateObjectType(name, item)
                break
            case 'union':
                generateUnionWhereInput(name, item)
                generateUnionType(name, item)
                break
            case 'enum':
                generateEnumType(name, item)
                break
        }
    }

    out.block('type Query', () => {
        for (let name in model) {
            if (model[name].kind == 'entity') {
                out.line(`${lowerCaseFirst(pluralize(name))}${manyArguments(name)}: [${name}!]!`)
            }
        }
    })

    function generateObjectType(name: string, object: Entity | JsonObject): void {
        out.block(`type ${name}`, () => {
            for (let key in object.properties) {
                let prop = object.properties[key]
                out.line(`${key}: ${renderPropType(prop.type, prop.nullable)}`)
            }
            if (object.kind == 'object') return
            for (let key in object.relations) {
                let rel = object.relations[key]
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

    function renderPropType(propType: PropType, nullable: boolean): string {
        switch(propType.kind) {
            case "list":
                return `[${renderPropType(propType.item, propType.nullableItem)}]${nullable ? '' : '!'}`
            default:
                return propType.name + (nullable ? '' : '!')
        }
    }

    function manyArguments(relatedEntityName: string): string {
        return `(where: ${relatedEntityName}WhereInput offset: Int limit: Int)`
    }

    function generateOrderByInput(name: string, entity: Entity): void {
        out.block(`enum ${name}OrderByInput`, () => {
            for (let col in entity.properties) {
                out.line(`${col}_ASC`)
                out.line(`${col}_DESC`)
            }
        })
        out.line()
    }

    function generateWhereInput(name: string, object: Entity | JsonObject): void {
        out.block(`input ${name}WhereInput`, () => {
            generatePropsFilters(object.properties)
            if (object.kind == 'entity') {
                for (let key in object.relations) {
                    generateRelationFilters(key, object.relations[key])
                }
            }
            out.line(`AND: [${name}WhereInput!]`)
            out.line(`OR: [${name}WhereInput!]`)
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
            // out.line('isTypeOf_in: [String!]')
            // out.line('isTypeOf_not_in: [String!]')

            let props: Record<string, Prop> = {}
            union.variants.forEach(variant => {
                let obj = getObject(variant)
                let conflicts = new Set<string>()
                for (let key in obj.properties) {
                    let prop = obj.properties[key]
                    if (props[key] == null) {
                        props[key] = prop
                    } else if (!propTypeEquals(prop.type, props[key].type)) {
                        conflicts.add(key)
                    }
                }
                conflicts.forEach(key => {
                    delete props[key]
                })
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

    function generateRelationFilters(fieldName: string, rel: Relation): void {
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

    function generateUnionType(name: string, union: Union) {
        out.line(`union ${name} = ${union.variants.join(' | ')}`)
        out.line()
    }

    function generateEnumType(name: string, e: Enum): void {
        out.block(`enum ${name}`, () => {
            for (let key in e.values) {
                out.line(key)
            }
        })
    }

    return out.toString()
}


function propTypeEquals(a: PropType, b: PropType): boolean {
    if (a.kind != b.kind) return false
    if (a.kind == 'list') return propTypeEquals(a.item, (b as typeof a).item)
    return a.name == (b as typeof a).name
}


export function buildServerSchema(schema: GraphQLSchema): DocumentNode {
    let scalars = scalars_list.map(name => 'scalar ' + name).join('\n')
    let queries = generateOpenCrudQueries(schema)
    return gql(scalars  + '\n\n' + queries)
}
