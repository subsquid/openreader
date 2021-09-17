import type {IFieldResolver, IResolvers} from "@graphql-tools/utils"
import assert from "assert"
import type {GraphQLResolveInfo, KindEnum} from "graphql"
import graphqlFields from "graphql-fields"
import type {ClientBase} from "pg"
import type {Entity, JsonObject, Model, PropType, Union} from "./model"
import {getUnionProps} from "./model.tools"
import {fromJsonCast, fromJsonToTransportCast, fromTransportCast, getScalarResolvers, toTransportCast} from "./scalars"
import {ensureArray, toColumn, toFkColumn, toQueryListField, toTable} from "./util"
import {hasConditions, parseWhereField, WhereOp, whereOpToSqlOperator} from "./where"


export interface ResolverContext {
    db: ClientBase
    model: Model
}


export function buildResolvers(model: Model): IResolvers {
    let Query: Record<string, IFieldResolver<unknown, ResolverContext>> = {}
    let unions: Record<string, any> = {}
    for (let name in model) {
        switch(model[name].kind) {
            case 'entity':
                Query[toQueryListField(name)] = (source, args, context, info) => {
                    return resolveEntityList(name, args, context, info)
                }
                break
            case 'union':
                unions[name] = {
                    __resolveType: resolveUnionType
                }
                break
        }
    }
    return {Query, ...unions, ...getScalarResolvers()}
}


function resolveUnionType(obj: any): string {
    return obj.isTypeOf
}


export interface ListArgs {
    offset?: number
    limit?: number
    orderBy?: string[]
    where?: any
}


async function resolveEntityList(entityName: string, args: ListArgs, context: ResolverContext, info: GraphQLResolveInfo): Promise<any[]> {
    let fields = requestedFields(info)
    let query = new QueryBuilder(context)
    let sql = query.select(entityName, args, fields)
    console.log('\n' + sql)
    let result = await context.db.query({text: sql, rowMode: 'array'}, query.params)
    return query.toResult(result.rows, entityName, fields)
}


function requestedFields(info: GraphQLResolveInfo): RequestedFields {
    return graphqlFields(info, {}, {
        processArguments: true,
        excludedFields: ['__typename']
    })
}


export type RequestedFields = {
    [field: string]: RequestedFields
} & {
    __arguments?: FieldArgument[]
}


/*
 * Argument of a nested field extracted by graphql-fields
 */
interface FieldArgument {
    [name: string]: {
        kind: KindEnum
        value: any
    }
}


function toListArgs(fieldArguments?: FieldArgument[]): ListArgs {
    if (!fieldArguments) return {}
    let list: ListArgs = {}
    fieldArguments.forEach(arg => {
        for (let name in arg) {
            let value = arg[name].value
            switch(name) {
                case 'orderBy':
                    let orderBy = value
                    if (!Array.isArray(orderBy)) {
                        // https://github.com/robrichard/graphql-fields/issues/32
                        orderBy = [orderBy]
                    }
                    list.orderBy = orderBy
                    break
                case 'where':
                case 'limit':
                case 'offset':
                    list[name] = value
                    break
            }
        }
    })
    return list
}


class QueryBuilder {
    public params: any[] = []
    private aliases: AliasSet = new AliasSet()
    private db: ClientBase
    private model: Model

    constructor(ctx: ResolverContext) {
        this.db = ctx.db
        this.model = ctx.model
    }

    private param(value: any): string {
        return '$' + this.params.push(value)
    }

    private ident(name: string): string {
        return this.db.escapeIdentifier(name)
    }

    private entity(entityName: string): Entity {
        let e = this.model[entityName]
        assert(e.kind == 'entity')
        return e
    }

    private object(objectName: string): JsonObject {
        let object = this.model[objectName]
        assert(object.kind == 'object')
        return object
    }

    private union(unionName: string): Union {
        let union = this.model[unionName]
        assert(union.kind == 'union')
        return union
    }

    select(entityName: string, args: ListArgs, fields?: RequestedFields, subquery?: ListSubquery): string {
        let entity = this.entity(entityName)
        let table = toTable(entityName)
        let alias = this.aliases.add(table)
        let join = new FkJoinSet(this.aliases)
        let whereExp = ''
        let out = ''

        if (fields) {
            let columns: string[] = []
            this.populateColumns(columns, join, fields, alias, '', entity)
            let columnExp = columns.join(', ')
            if (subquery) {
                columnExp = `jsonb_build_array(${columnExp})`
            }
            out += 'SELECT ' + columnExp + '\n'
        }

        out += `FROM ${this.ident(table)} ${this.ident(alias)}`

        if (hasConditions(args.where)) {
            whereExp = this.generateWhere(alias, entity, args.where, join)
        }

        if (join.isNotEmpty()) {
            out += join.render(name => this.ident(name))
        }

        if (subquery) {
            let subWhere = `${this.ident(alias)}.${this.ident(toFkColumn(subquery.field))} = ${this.ident(subquery.parent)}."id"`
            whereExp = whereExp ? `${subWhere} AND (${whereExp})` : subWhere
        }

        if (whereExp) {
            out += '\nWHERE ' + whereExp
        }

        if (args.limit) {
            out += '\nLIMIT ' + this.param(args.limit)
        }

        if (args.offset) {
            out += '\nOFFSET ' + this.param(args.offset)
        }

        if (subquery) {
            out = out.replace(/\n/g, ' ')
        }

        return out
    }

    private populateColumns(
        columns: string[],
        join: FkJoinSet,
        fields: RequestedFields,
        alias: string,
        prefix: string,
        object: Entity | JsonObject
    ): void {
        for (let key in fields) {
            if (key == '__arguments') {
                continue
            }
            if (object.properties[key]) {
                let prop = object.properties[key]

                let col = object.kind == 'entity'
                    ? this.ident(alias) + '.' + this.ident(toColumn(key))
                    : `${prefix}->'${key}'`

                switch(prop.type.kind) {
                    case 'scalar':
                    case 'enum':
                        if (object.kind == 'entity') {
                            columns.push(toTransportCast(prop.type.name, col))
                        } else {
                            columns.push(fromJsonToTransportCast(prop.type.name, prefix, key))
                        }
                        break
                    case 'object':
                        this.populateColumns(
                            columns,
                            join,
                            fields[key],
                            alias,
                            col,
                            this.object(prop.type.name)
                        )
                        break
                    case 'union':
                        columns.push(`${col}->>'isTypeOf'`)
                        this.populateColumns(
                            columns,
                            join,
                            fields[key],
                            alias,
                            col,
                            this.getUnionObject(prop.type.name)
                        )
                        break
                }
            } else {
                assert(object.kind == 'entity')
                let rel = object.relations[key]
                switch(rel.type) {
                    case 'FK':
                        let {id, ...restFields} = fields[key]
                        let fa = join.add(
                            toTable(rel.foreignEntity),
                            alias,
                            toFkColumn(key)
                        )
                        columns.push(this.ident(fa) + '."id"')
                        this.populateColumns(columns, join, restFields, fa, '', this.entity(rel.foreignEntity))
                        break
                    case 'LIST':
                        columns.push(
                            'array(' + this.select(rel.entity, toListArgs(fields[key].__arguments), fields[key], {
                                field: rel.field,
                                parent: alias
                            }) + ')'
                        )
                        break
                }
            }
        }
    }

    private generateWhere(alias: string, entity: Entity, where: any, join: FkJoinSet): string {
        let {AND, OR, ...conditions} = where
        let exps: string[] = []
        for (let key in conditions) {
            if (entity.relations[key]) {
                let f_where = conditions[key]
                if (hasConditions(f_where)) {
                    let rel = entity.relations[key]
                    assert(rel.type == 'FK')
                    exps.push(
                        this.generateWhere(
                            join.add(toTable(rel.foreignEntity), alias, toFkColumn(key)),
                            this.entity(rel.foreignEntity),
                            f_where,
                            join
                        )
                    )
                }
            } else {
                let opArg = conditions[key]
                let f = parseWhereField(key)
                switch(f.op) {
                    case 'every':
                        if (hasConditions(opArg)) {
                            let rel = entity.relations[f.field]
                            assert(rel.type == 'LIST')
                            let conditionedFrom = this.select(
                                rel.entity,
                                {where: opArg},
                                undefined,
                                {parent: alias, field: rel.field}
                            )
                            let allFrom = this.select(
                                rel.entity,
                                {},
                                undefined,
                                {parent: alias, field: rel.field}
                            )
                            exps.push(`(SELECT count(*) ${conditionedFrom}) = (SELECT count(*) ${allFrom})`)
                        }
                        break
                    case 'some':
                    case 'none':
                        let rel = entity.relations[f.field]
                        assert(rel.type == 'LIST')
                        let q = '(SELECT true ' + this.select(
                            rel.entity,
                            {where: opArg, limit: 1},
                            undefined,
                            {parent: alias, field: rel.field}
                        ) + ')'
                        if (f.op == 'some') {
                            exps.push(q)
                        } else {
                            exps.push(`(SELECT count(*) FROM ${q} ${this.ident(this.aliases.add(key))}) = 0`)
                        }
                        break
                    default: {
                        let prop = entity.properties[f.field]
                        assert(prop != null)
                        this.addPropCondition(exps, alias, f.field, prop.type, f.op, opArg)
                    }
                }
            }
        }
        if (AND) {
            // We are getting objects here, although we have array in schema
            ensureArray(AND).forEach((andWhere: any) => {
                if (hasConditions(andWhere)) {
                    exps.push(
                        this.generateWhere(alias, entity, andWhere, join)
                    )
                }
            })
        }
        if (OR) {
            let ors = [`(${exps.join(' AND ')})`]
            // We are getting objects here, although we have array in schema
            ensureArray(OR).forEach((orWhere: any) => {
                if (hasConditions(orWhere)) {
                    ors.push(
                        `(${this.generateWhere(alias, entity, orWhere, join)})`
                    )
                }
            })
            return ors.join(' OR ')
        } else {
            return exps.join(' AND ')
        }
    }

    private addPropCondition(exps: string[], aliasOrPrefix: string, field: string, propType: PropType, op: WhereOp, arg: any, isJson?: boolean): void {
        let lhs = isJson
            ? `${aliasOrPrefix}->'${field}'`
            : this.ident(aliasOrPrefix) + '.' + this.ident(toColumn(field))

        switch(propType.kind) {
            case 'scalar':
            case 'enum': {
                if (isJson) {
                    lhs = fromJsonCast(propType.name, aliasOrPrefix, field)
                }
                switch(op) {
                    case 'in':
                    case 'not_in': {
                        // We have 2 options here
                        // 1. use array parameter and do: WHERE col IN (SELECT * FROM unnest($array_param))
                        // 2. use arg list
                        // Let's try second option first.
                        let list = ensureArray(arg).map(a => fromTransportCast(propType.name, this.param(a)))
                        let param = `(${list.join(', ')})`
                        exps.push(`${lhs} ${whereOpToSqlOperator(op)} ${param}`)
                        break
                    }
                    case 'starts_with':
                        exps.push(`starts_with(${lhs}, ${this.param(arg)})`)
                        break
                    case 'not_starts_with':
                        exps.push(`NOT starts_with(${lhs}, ${this.param(arg)})`)
                        break
                    case 'ends_with': {
                        let param = this.param(arg)
                        exps.push(`right(${lhs}, length(${param})) = ${param}`)
                        break
                    }
                    case 'not_ends_with': {
                        let param = this.param(arg)
                        exps.push(`right(${lhs}, length(${param})) != ${param}`)
                        break
                    }
                    case 'contains':
                        exps.push(`position(${this.param(arg)} in ${lhs}) > 0`)
                        break
                    case 'not_contains':
                        exps.push(`position(${this.param(arg)} in ${lhs}) = 0`)
                        break
                    default: {
                        let param = fromTransportCast(propType.name, this.param(arg))
                        exps.push(`${lhs} ${whereOpToSqlOperator(op)} ${param}`)
                    }
                }
                return
            }
            case 'union': {
                assert(op == 'eq') // meaning no operator
                for (let key in arg) {
                    let f = parseWhereField(key)
                    let unionPropType = this.getUnionPropType(propType.name, f.field)
                    this.addPropCondition(exps, lhs, f.field, unionPropType, f.op, arg[key], true)
                }
                return
            }
            case 'object': {
                assert(op == 'eq') // meaning no operator
                let object = this.object(propType.name)
                for (let key in arg) {
                    let f = parseWhereField(key)
                    this.addPropCondition(exps, lhs, f.field, object.properties[f.field].type, f.op, arg[key], true)
                }
                return
            }
            default:
                throw new Error(`Where condition on field ${field} of kind ${propType.kind}`)
        }
    }

    private getUnionPropType(unionName: string, name: string): PropType {
        if (name == 'isTypeOf') return {kind: 'scalar', name: 'String'}
        let prop = this.getUnionObject(unionName).properties[name]
        if (prop == null) {
            throw new Error(`Unknown property ${name} on union ${unionName}`)
        }
        return prop.type
    }

    private getUnionObject(unionName: string): JsonObject {
        return getUnionProps(this.model, unionName)
    }

    toResult(rows: any[][], entityName: string, fields: RequestedFields): any[] {
        let entity = this.entity(entityName)
        let out: any[] = new Array(rows.length)
        for (let i = 0; i < rows.length; i++) {
            out[i] = this.mapRow(rows[i], 0, entity, fields).rec
        }
        return out
    }

    private mapRow(row: any[], idx: number, object: Entity | JsonObject, fields: RequestedFields): {rec: any, idx: any} {
        let rec: any = {}
        for (let key in fields) {
            if (key == '__arguments') {
                continue
            }
            if (object.properties[key]) {
                let prop = object.properties[key]
                switch(prop.type.kind) {
                    case 'scalar':
                    case 'enum':
                        rec[key] = row[idx]
                        idx += 1
                        break
                    case 'object': {
                        let m = this.mapRow(row, idx, this.object(prop.type.name), fields[key])
                        rec[key] = m.rec
                        idx = m.idx
                        break
                    }
                    case 'union': {
                        let isTypeOf = row[idx]
                        idx += 1
                        let m = this.mapRow(row, idx, this.getUnionObject(prop.type.name), fields[key])
                        idx = m.idx
                        if (isTypeOf != null) {
                            m.rec.isTypeOf = isTypeOf
                            rec[key] = m.rec
                        }
                        break
                    }
                    default:
                        throw new Error(`Property ${key} has unsupported kind ${prop.type.kind}`)
                }
            } else {
                assert(object.kind == 'entity')
                let rel = object.relations[key]
                switch(rel.type) {
                    case 'FK':
                        let {id: _id, ...restFields} = fields[key]
                        let id = row[idx]
                        idx += 1
                        let m = this.mapRow(row, idx, this.entity(rel.foreignEntity), restFields)
                        idx = m.idx
                        if (id != null) {
                            // the mapping above is valid only if entity actually exists,
                            // otherwise all props are just nulls
                            m.rec.id = id
                            rec[key] = m.rec
                        }
                        break
                    case 'LIST':
                        rec[key] = this.toResult(row[idx], rel.entity, fields[key])
                        idx += 1
                        break
                }
            }
        }
        return {rec, idx}
    }
}


/**
 * (SELECT ... FROM table WHERE table.{toFkColumn(field)} = {parent}.id)
 */
interface ListSubquery {
    field: string
    parent: string
}


/**
 * LEFT OUTER JOIN {table} {alias} on {alias}.id = {on_alias}.{on_field}
 */
interface FK_Join {
    table: string
    alias: string
    on_alias: string
    on_field: string
}


class FkJoinSet {
    private joins: Map<string, FK_Join> = new Map()

    constructor(private aliases: AliasSet) {}

    add(table: string, on_alias: string, on_field: string): string {
        let key = table + '  ' + on_alias + '  ' + on_field
        let e = this.joins.get(key)
        if (!e) {
            e = {
                table,
                alias: this.aliases.add(table),
                on_alias,
                on_field
            }
            this.joins.set(key, e)
        }
        return e.alias
    }

    isNotEmpty() {
        return this.joins.size > 0
    }

    render(escapeIdentifier: (name: string) => string): string {
        let e = escapeIdentifier
        let out = ''
        this.joins.forEach(join => {
            out += `\nLEFT OUTER JOIN ${e(join.table)} ${e(join.alias)} ON ${e(join.alias)}."id" = ${e(join.on_alias)}.${e(join.on_field)}`
        })
        return out
    }
}


class AliasSet {
    private aliases: Record<string, number> = {}

    add(name: string): string {
        if (this.aliases[name]) {
            return name + '_' + (this.aliases[name]++)
        } else {
            this.aliases[name] = 1
            return name
        }
    }
}
