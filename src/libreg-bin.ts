#!/usr/bin/env node

import Yargs from 'yargs';
import {readFileSync} from 'fs';
import {Registry} from './libreg';

const argv = Yargs
    .scriptName('libreg')
    .usage('$0 <cmd> [args]')

    .parserConfiguration({
        'duplicate-arguments-array': false
    })
    .help()

    .command('dump <file>', 'Dumps entry tree of a registry file', dump =>
        dump
            .positional('file', {
                type: 'string',
                description: 'Registry file path to dump'
            })
    , args => {
        const file = args.file;
        const fileData = readFileSync(file);
        const reg = new Registry(fileData);
        console.log(JSON.stringify(
            reg.rootObject, null, '  '
        ));
    })
    .demandCommand(1, 1)

    .argv;
