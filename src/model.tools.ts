import assert from "assert"
import {JsonObject, Model, Prop} from "./model"


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
