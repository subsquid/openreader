export type Name = string


export type Model = Record<Name, Entity | JsonObject | Interface | Union | Enum>


export interface Entity extends TypeMeta {
    kind: 'entity'
    properties: Record<Name, Prop>
    interfaces?: Name[]
}


export interface JsonObject extends TypeMeta {
    kind: 'object'
    properties: Record<Name, Prop>
    interfaces?: Name[]
}


export interface Interface extends TypeMeta {
    kind: 'interface'
    properties: Record<Name, Prop>
}


export interface Union extends TypeMeta {
    kind: 'union'
    variants: Name[]
}


export interface Enum extends TypeMeta {
    kind: 'enum'
    values: Record<string, {}>
}


export interface TypeMeta {
    description?: string
}


export interface Prop {
    type: PropType
    nullable: boolean
    description?: string
}


export type PropType =
    ScalarPropType |
    EnumPropType |
    ListPropType |
    ObjectPropType |
    UnionPropType |
    FkPropType |
    ListRelPropType


export interface ScalarPropType {
    kind: 'scalar'
    name: Name
}


export interface EnumPropType {
    kind: 'enum'
    name: Name
}


export interface ObjectPropType {
    kind: 'object'
    name: Name
}


export interface UnionPropType {
    kind: 'union'
    name: Name
}


export interface ListPropType {
    kind: 'list'
    item: Prop
}


export interface FkPropType {
    kind: 'fk'
    foreignEntity: Name
}


export interface ListRelPropType {
    kind: 'list-relation'
    entity: Name
    field: Name
}
