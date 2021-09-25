import assert from "assert"
import type {ClientBase, QueryArrayResult} from "pg"
import type {Entity, JsonObject, Model} from "./model"
import {getEntity, getFtsQuery, getUnionProps} from "./model.tools"
import {OpenCrudOrderByValue, OrderBy, parseOrderBy} from "./orderBy"
import type {FtsRequestedFields, RequestedFields} from "./requestedFields"
import type {ResolverContext} from "./resolver"
import {
    fromJsonCast,
    fromJsonToTransportCast,
    fromTransportCast,
    toTransportArrayCast,
    toTransportCast
} from "./scalars"
import {ensureArray, snakeCase, toColumn, toFkColumn, toInt, toTable, unsupportedCase} from "./util"
import {hasConditions, parseWhereField, WhereOp, whereOpToSqlOperator} from "./where"


export interface ListArgs {
    offset?: number
    limit?: number
    orderBy?: OpenCrudOrderByValue[]
    where?: any
}


export class QueryBuilder {
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

    select(entityName: string, args: ListArgs, fields?: RequestedFields, variant?: SelectVariant): string {
        let entity = getEntity(this.model, entityName)
        let table = toTable(entityName)
        let alias = this.aliases.add(table)
        let join = new FkJoinSet(this.aliases)

        let cursor = new Cursor(
            this.model,
            this.ident.bind(this),
            this.aliases,
            join,
            entity,
            alias,
            ''
        )

        let whereExps: string[] = []
        let orderByExps: string[] = []
        let columns = new ColumnSet()
        let out = ''

        if (fields) {
            this.populateColumns(columns, cursor, fields)
        }

        switch(variant?.kind) {
            case 'fts':
                out += 'SELECT\n'
                out += `    '${entityName}' AS isTypeOf`
                out += ',\n'
                out += `    ts_rank(${cursor.tsv(variant.queryName)}, phraseto_tsquery('english', ${variant.textParam})) AS rank`
                out += ',\n'
                out += `    ts_headline(${cursor.doc(variant.queryName)}, phraseto_tsquery('english', ${variant.textParam})) AS highlight`
                out += ',\n'
                out += columns.size() ? `    json_build_array(${columns.render()})` : "    '[]'::json"
                out += ' AS item\n'
                break
            case 'list-subquery':
                if (columns.size()) {
                    out += `SELECT json_build_array(${columns.render()}) `
                }
                break
            default:
                if (columns.size()) {
                    out += `SELECT ${columns.render()}\n`
                }
        }

        out += `FROM ${this.ident(table)} ${this.ident(alias)}`

        if (hasConditions(args.where)) {
            whereExps.push(this.generateWhere(cursor, args.where))
        }

        if (variant?.kind == 'list-subquery') {
            whereExps.push(`${cursor.fk(variant.field)} = ${variant.parent}`)
        }

        if (variant?.kind == 'fts') {
            whereExps.push(`phraseto_tsquery('english', ${variant.textParam}) @@ ${cursor.tsv(variant.queryName)}`)
        }

        let orderByInput = args.orderBy && ensureArray(args.orderBy)
        if (orderByInput?.length) {
            let orderBy = parseOrderBy(this.model, entityName, orderByInput)
            this.populateOrderBy(orderByExps, cursor, orderBy)
        }

        if (join.isNotEmpty()) {
            out += join.render(name => this.ident(name))
        }

        if (whereExps.length) {
            out += '\nWHERE ' + whereExps.join(' AND ')
        }

        if (orderByExps.length > 0) {
            out += '\nORDER BY ' + orderByExps.join(', ')
        }

        if (args.limit) {
            out += '\nLIMIT ' + this.param(args.limit)
        }

        if (args.offset) {
            out += '\nOFFSET ' + this.param(args.offset)
        }

        if (variant?.kind == 'list-subquery') {
            out = out.replace(/\n/g, ' ')
        }

        return out
    }

    private populateOrderBy(
        exps: string[],
        cursor: Cursor,
        orderBy: OrderBy
    ) {
        for (let key in orderBy) {
            let spec = orderBy[key]
            let propType = cursor.object.properties[key].type
            switch(propType.kind) {
                case 'scalar':
                case 'enum':
                    assert(typeof spec == 'string')
                    exps.push(`${cursor.native(key)} ${spec}`)
                    break
                case 'object':
                case 'union':
                case 'fk':
                    assert(typeof spec == 'object')
                    this.populateOrderBy(
                        exps,
                        cursor.child(key),
                        spec
                    )
                    break
                default:
                    throw unsupportedCase(propType.kind)
            }
        }
    }

    private populateColumns(
        columns: ColumnSet,
        cursor: Cursor,
        fields$?: RequestedFields
    ): void {
        for (let fieldName in fields$) {
            let field = fields$[fieldName]
            for (let i = 0; i < field.requests.length; i++) {
                let req = field.requests[i]
                switch(field.propType.kind) {
                    case 'scalar':
                    case 'enum':
                    case 'list':
                        req.index = columns.add(cursor.transport(fieldName))
                        break
                    case 'object':
                        req.index = columns.add(cursor.field(fieldName) + ' IS NULL')
                        this.populateColumns(
                            columns,
                            cursor.child(fieldName),
                            req.children
                        )
                        break
                    case 'union':
                        let cu = cursor.child(fieldName)
                        req.index = columns.add(cu.transport('isTypeOf'))
                        this.populateColumns(
                            columns,
                            cu,
                            req.children
                        )
                        break
                    case 'fk': {
                        let cu = cursor.child(fieldName)
                        req.index = columns.add(cu.transport('id'))
                        this.populateColumns(
                            columns,
                            cu,
                            req.children
                        )
                        break
                    }
                    case 'list-relation':
                        req.index = columns.add(
                            'array(' + this.select(field.propType.entity, req.args, req.children, {
                                kind: 'list-subquery',
                                field: field.propType.field,
                                parent: cursor.native('id')
                            }) + ')'
                        )
                        break
                    default:
                        throw unsupportedCase((field as any).propType.kind)
                }
            }
        }
    }

    private generateWhere(cursor: Cursor, where: any): string {
        let {AND, OR, ...conditions} = where
        let exps: string[] = []
        for (let key in conditions) {
            let opArg = conditions[key]
            let f = parseWhereField(key)
            switch(f.op) {
                case 'every':
                    if (hasConditions(opArg)) {
                        let rel = cursor.object.properties[f.field].type
                        assert(rel.kind == 'list-relation')
                        let conditionedFrom = this.select(
                            rel.entity,
                            {where: opArg},
                            undefined,
                            {kind: 'list-subquery', parent: cursor.native('id'), field: rel.field}
                        )
                        let allFrom = this.select(
                            rel.entity,
                            {},
                            undefined,
                            {kind: 'list-subquery', parent: cursor.native('id'), field: rel.field}
                        )
                        exps.push(`(SELECT count(*) ${conditionedFrom}) = (SELECT count(*) ${allFrom})`)
                    }
                    break
                case 'some':
                case 'none':
                    let rel = cursor.object.properties[f.field].type
                    assert(rel.kind == 'list-relation')
                    let q = '(SELECT true ' + this.select(
                        rel.entity,
                        {where: opArg},
                        undefined,
                        {kind: 'list-subquery', parent: cursor.native('id'), field: rel.field}
                    ) + ' LIMIT 1)'
                    if (f.op == 'some') {
                        exps.push(q)
                    } else {
                        exps.push(`(SELECT count(*) FROM ${q} ${this.ident(this.aliases.add(key))}) = 0`)
                    }
                    break
                default: {
                    let prop = cursor.object.properties[f.field]
                    assert(prop != null)
                    this.addPropCondition(exps, cursor, f.field, f.op, opArg)
                }
            }
        }
        if (AND) {
            // We are getting objects here, although we have array in schema
            ensureArray(AND).forEach((andWhere: any) => {
                if (hasConditions(andWhere)) {
                    exps.push(
                        this.generateWhere(cursor, andWhere)
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
                        `(${this.generateWhere(cursor, orWhere)})`
                    )
                }
            })
            return '(' + ors.join(' OR ') + ')'
        } else {
            return exps.join(' AND ')
        }
    }

    private addPropCondition(exps: string[], cursor: Cursor, field: string, op: WhereOp, arg: any): void {
        let propType = cursor.object.properties[field].type
        switch(propType.kind) {
            case 'scalar':
            case 'enum': {
                let lhs = cursor.native(field)
                let typeName = propType.name
                switch(op) {
                    case 'in':
                    case 'not_in': {
                        // We have 2 options here
                        // 1. use array parameter and do: WHERE col IN (SELECT * FROM unnest($array_param))
                        // 2. use arg list
                        // Let's try second option first.
                        let list = ensureArray(arg).map(a => fromTransportCast(typeName, this.param(a)))
                        let param = `(${list.join(', ')})`
                        exps.push(`${lhs} ${whereOpToSqlOperator(op)} ${param}`)
                        break
                    }
                    case 'startsWith':
                        exps.push(`starts_with(${lhs}, ${this.param(arg)})`)
                        break
                    case 'not_startsWith':
                        exps.push(`NOT starts_with(${lhs}, ${this.param(arg)})`)
                        break
                    case 'endsWith': {
                        let param = this.param(arg)
                        exps.push(`right(${lhs}, length(${param})) = ${param}`)
                        break
                    }
                    case 'not_endsWith': {
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
                break
            }
            case 'object':
            case 'union': {
                assert(op == '-')
                let cu = cursor.child(field)
                for (let key in arg) {
                    let f = parseWhereField(key)
                    this.addPropCondition(exps, cu, f.field, f.op, arg[key])
                }
                break
            }
            case 'fk': {
                assert(op == '-')
                if (hasConditions(arg)) {
                    exps.push(
                        this.generateWhere(cursor.child(field), arg)
                    )
                }
                break
            }
            default:
                throw unsupportedCase(propType.kind)
        }
    }

    toResult(rows: any[][], fields?: RequestedFields): any[] {
        let out: any[] = new Array(rows.length)
        for (let i = 0; i < rows.length; i++) {
            out[i] = this.mapRow(rows[i], fields)
        }
        return out
    }

    private mapRow(row: any[], fields?: RequestedFields, ifType?: string): any {
        let rec: any = {}
        for (let key in fields) {
            let f = fields[key]
            for (let i = 0; i < f.requests.length; i++) {
                let req = f.requests[i]
                if (req.ifType != ifType) continue
                switch(f.propType.kind) {
                    case 'scalar':
                    case 'enum':
                    case 'list':
                        rec[req.alias] = row[req.index]
                        break
                    case 'object': {
                        let isNull = row[req.index]
                        if (!isNull) {
                            rec[req.alias] = this.mapRow(row, req.children)
                        }
                        break
                    }
                    case 'union': {
                        let isTypeOf = row[req.index]
                        if (isTypeOf != null) {
                            let obj = this.mapRow(row, req.children, isTypeOf)
                            obj.isTypeOf = isTypeOf
                            rec[req.alias] = obj
                        }
                        break
                    }
                    case 'fk': {
                        let id = row[req.index]
                        if (id != null) {
                            rec[req.alias] = this.mapRow(row, req.children)
                        }
                        break
                    }
                    case 'list-relation':
                        rec[req.alias] = this.toResult(row[req.index], req.children)
                        break
                    default:
                        throw unsupportedCase((f as any).propType.kind)
                }
            }
        }
        return rec
    }

    async executeSelect(entityName: string, args: ListArgs, fields$: RequestedFields): Promise<any[]> {
        let sql = this.select(entityName, args, fields$)
        let result = await this.query(sql)
        return this.toResult(result.rows, fields$)
    }

    async executeSelectCount(entityName: string, where?: any): Promise<number> {
        let sql = `SELECT count(*) ${this.select(entityName, {where})}`
        let result = await this.query(sql)
        return toInt(result.rows[0][0])
    }

    async executeListCount(entityName: string, args: ListArgs): Promise<number> {
        let sql = `SELECT count(*) FROM (SELECT true ${this.select(entityName, args)}) AS ${this.aliases.add('list')}`
        let result = await this.query(sql)
        return toInt(result.rows[0][0])
    }

    private query(sql: string): Promise<QueryArrayResult> {
        // console.log('\n' + sql)
        return this.db.query({text: sql, rowMode: 'array'}, this.params)
    }

    fulltextSearchSelect(queryName: string, args: any, $fields: FtsRequestedFields): string {
        let query = getFtsQuery(this.model, queryName)
        let {limit, offset, text} = args
        let textParam = this.param(text)

        let srcSelects: string[] = []
        query.sources.forEach(src => {
            let where = args[`where${src.entity}`]
            let itemFields = $fields.item?.[src.entity]
            let sql = this.select(src.entity, {where}, itemFields, {kind: 'fts', textParam, queryName})
            srcSelects.push(sql)
        })

        let cols: string[] = []
        cols.push('isTypeOf')
        cols.push('rank')
        if ($fields.highlight) {
            cols.push('highlight')
        }
        if ($fields.item) {
            cols.push('item')
        }

        let sql = `SELECT ${cols.join(', ')} FROM (\n\n`
        sql += srcSelects.join('\n\nUNION ALL\n\n')
        sql += `\n\n) AS ${this.aliases.add('tsv')}`
        sql += ` ORDER BY rank DESC`
        if (limit != null) {
            sql += ` LIMIT ${this.param(limit)}`
        }
        if (offset != null) {
            sql += ` OFFSET ${this.param(offset)}`
        }
        return sql
    }

    toFulltextSearchResult(rows: any[][], fields: FtsRequestedFields): FtsItem[] {
        let out: FtsItem[] = new Array(rows.length)
        for (let i = 0; i < rows.length; i++) {
            let row = rows[i]
            let isTypeOf = row[0]
            let highlight = fields.highlight ? row[2] : undefined
            let itemIdx = fields.highlight ? 3 : 2
            let itemFields = fields.item?.[isTypeOf]
            let item: any
            if (itemFields) {
                item = this.mapRow(row[itemIdx], itemFields)
                item.isTypeOf = isTypeOf
            } else {
                item = {isTypeOf}
            }
            out[i] = {
                rank: row[1],
                highlight,
                item
            }
        }
        return out
    }

    async executeFulltextSearch(queryName: string, args: any, $fields: FtsRequestedFields): Promise<FtsItem[]> {
        let sql = this.fulltextSearchSelect(queryName, args, $fields)
        let result = await this.query(sql)
        return this.toFulltextSearchResult(result.rows, $fields)
    }
}


export interface FtsItem {
    rank?: number
    highlight?: string
    item?: any
}


type SelectVariant = FtsVariant | ListSubquery


interface FtsVariant {
    kind: 'fts'
    queryName: string
    textParam: string // builder.param(text)
}


/**
 * SELECT json_build_array(...fields) FROM ... WHERE {toFkColumn(field)} = {parent}
 */
interface ListSubquery {
    kind: 'list-subquery'
    field: string
    parent: string
}


class Cursor {
    constructor(
        private model: Model,
        private ident: (name: string) => string,
        private aliases: AliasSet,
        private join: FkJoinSet,
        public readonly object: Entity | JsonObject,
        private alias: string,
        private prefix: string
    ) {
    }

    transport(propName: string): string {
        let prop = this.object.properties[propName]
        switch(prop.type.kind) {
            case 'scalar':
            case 'enum':
                if (this.object.kind == 'object') {
                    return fromJsonToTransportCast(prop.type.name, this.prefix, propName)
                } else {
                    return toTransportCast(prop.type.name, this.column(propName))
                }
            case 'list':
                let itemType = prop.type.item.type
                if (this.object.kind == 'object' || itemType.kind != 'scalar' && itemType.kind != 'enum') {
                    // this is json
                    return this.field(propName)
                } else {
                    return toTransportArrayCast(itemType.name, this.column(propName))
                }
            default:
                throw unsupportedCase(prop.type.kind)
        }
    }

    native(propName: string): string {
        let prop = this.object.properties[propName]
        assert(prop.type.kind == 'scalar' || prop.type.kind == 'enum')
        if (this.object.kind == 'object') {
            return fromJsonCast(prop.type.name, this.prefix, propName)
        } else {
            return this.column(propName)
        }
    }

    child(propName: string): Cursor {
        let object: Entity | JsonObject
        let alias: string
        let prefix: string

        let prop = this.object.properties[propName]
        switch(prop.type.kind) {
            case 'object':
                object = this.model[prop.type.name] as JsonObject
                alias = this.alias
                prefix = this.field(propName)
                break
            case 'union':
                object = getUnionProps(this.model, prop.type.name)
                alias = this.alias
                prefix = this.field(propName)
                break
            case 'fk':
                object = this.model[prop.type.foreignEntity] as Entity
                alias = this.join.add(
                    toTable(prop.type.foreignEntity),
                    this.fk(propName)
                )
                prefix = ''
                break
            default:
                throw unsupportedCase(prop.type.kind)
        }

        return new Cursor(
            this.model,
            this.ident,
            this.aliases,
            this.join,
            object,
            alias,
            prefix
        )
    }

    field(name: string): string {
        if (this.object.kind == 'entity') {
            return this.column(name)
        } else {
            return `${this.prefix}->'${name}'`
        }
    }

    private column(name: string) {
        assert(this.object.kind == 'entity')
        return this.ident(this.alias) + '.' + this.ident(toColumn(name))
    }

    fk(propName: string): string {
        return this.object.kind == 'entity'
            ? this.ident(this.alias) + '.' + this.ident(toFkColumn(propName))
            : fromJsonCast('ID', this.prefix, propName)
    }

    tsv(queryName: string): string {
        assert(this.object.kind == 'entity')
        return this.ident(this.alias) + '.' + this.ident(snakeCase(queryName) + '_tsv')
    }

    doc(queryName: string): string {
        assert(this.object.kind == 'entity')
        return this.ident(this.alias) + '.' + this.ident(snakeCase(queryName) + '_doc')
    }
}


class ColumnSet {
    private columns: Map<string, number> = new Map()

    add(column: string): number {
        let idx = this.columns.get(column)
        if (idx == null) {
            idx = this.columns.size
            this.columns.set(column, idx)
        }
        return idx
    }

    render(): string {
        return Array.from(this.columns.keys()).join(', ')
    }

    size(): number {
        return this.columns.size
    }
}


/**
 * LEFT OUTER JOIN {table} {alias} on {alias}.id = {on}
 */
interface FK_Join {
    table: string
    alias: string
    on: string
}


class FkJoinSet {
    private joins: Map<string, FK_Join> = new Map()

    constructor(private aliases: AliasSet) {
    }

    add(table: string, on: string): string {
        let key = table + '  ' + on
        let e = this.joins.get(key)
        if (!e) {
            e = {
                table,
                alias: this.aliases.add(table),
                on
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
            out += `\nLEFT OUTER JOIN ${e(join.table)} ${e(join.alias)} ON ${e(join.alias)}."id" = ${join.on}`
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
