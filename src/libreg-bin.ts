#!/usr/bin/env node

import Yargs from 'yargs';
import {readFileSync} from 'fs';
import {RegisterKey, Registry} from './libreg';

const argv = Yargs
    .scriptName('libreg')
    .usage('$0 <cmd> [args]')

    .parserConfiguration({
        'duplicate-arguments-array': false
    })
    .help()

    .command('dump <file> [keypath] [entryname]', 'Dumps entry tree of a registry file', dump =>
        dump
            .positional('file', {
                type: 'string',
                description: 'Registry file path to dump'
            })
            .positional('keypath', {
                type: 'string',
                description: 'Path to the key to dump',
                default: ''
            })
            .positional('entryname', {
                type: 'string',
                description: 'Name of entry in the key to dump'
            })
    , args => {
        const file = args.file;
        const fileData = readFileSync(file);
        const root = new Registry(fileData).rootObject as RegisterKey;
        if (!(root instanceof RegisterKey)) {
            throw new Error('root object is not a key');
        }
        const entryName = args.entryname;
        const key = root.findKey(args.keypath);
        let dump: any = entryName == null ? key : key?.findChildValue(entryName);
        if (dump == null) {
            dump = null;
        } else if(dump instanceof RegisterKey) {
        } else if (dump instanceof Buffer) {
            dump = {
                bytes: dump.toString('hex')
            };
        } else if(dump instanceof Int32Array) {
            dump = [...dump];
        } else if(typeof dump === 'string') {
        } else if(dump instanceof Error) {
            dump = {
                error: dump.name + ' ' + dump.message
            };
        } else {
            dump = {
                error: 'unexpected value',
                value: dump
            }
        }
        console.log(JSON.stringify(
            dump, null, '  '
        ));
    })
    .demandCommand(1, 1)

    .argv;
