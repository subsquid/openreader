import assert from "assert"
import {Entity, FTS_Query, JsonObject, Model, Prop, PropType} from "./model"


const UNION_MAPS = new WeakMap<Model, Record<string, JsonObject>>()


export function getUnionProps(model: Model, unionName: string): JsonObject {
    let map = UNION_MAPS.get(model)
    if (map == null) {
        map = {}
        UNION_MAPS.set(model, map)
    }
    if (map[unionName]) return map[unionName]
    return map[unionName] = buildUnionProps(model, unionName)
}


export function buildUnionProps(model: Model, unionName: string): JsonObject {
    let union = model[unionName]
    assert(union.kind == 'union')
    let properties: Record<string, Prop> = {}
    for (let i = 0; i < union.variants.length; i++) {
        let objectName = union.variants[i]
        let object = model[objectName]
        assert(object.kind == 'object')
        Object.assign(properties, object.properties)
    }
    properties.isTypeOf = {
        type: {kind: 'scalar', name: 'String'},
        nullable: false
    }
    return {kind: 'object', properties}
}


export function validateUnionTypes(model: Model): void {
    for (let key in model) {
        let item = model[key]
        if (item.kind != 'union') continue
        let properties: Record<string, { objectName: string, type: PropType }> = {}
        item.variants.forEach(objectName => {
            let object = model[objectName]
            assert(object.kind == 'object')
            for (let propName in object.properties) {
                let rec = properties[propName]
                if (rec && !propTypeEquals(rec.type, object.properties[propName].type)) {
                    throw new Error(
                        `${rec.objectName} and ${objectName} variants of union ${key} both have property '${propName}', but types of ${rec.objectName}.${propName} and ${objectName}.${propName} are different.`
                    )
                } else {
                    properties[propName] = {objectName, type: object.properties[propName].type}
                }
            }
        })
    }
}


export function propTypeEquals(a: PropType, b: PropType): boolean {
    if (a.kind != b.kind) return false
    if (a.kind == 'list') return propTypeEquals(a.item.type, (b as typeof a).item.type)
    switch(a.kind) {
        case 'fk':
            return a.foreignEntity == (b as typeof a).foreignEntity
        case 'list-relation':
            return a.entity == (b as typeof a).entity && a.field == (b as typeof a).field
        default:
            return a.name == (b as typeof a).name
    }
}


export function getEntity(model: Model, name: string): Entity {
    let entity = model[name]
    assert(entity.kind == 'entity')
    return entity
}


export function getFtsQuery(model: Model, name: string): FTS_Query {
    let query = model[name]
    assert(query.kind == 'fts')
    return query
}
