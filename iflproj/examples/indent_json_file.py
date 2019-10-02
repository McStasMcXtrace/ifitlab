#!/usr/bin/env python
# -*- coding: utf-8 -*-
'''
Replaces input file contents with indent=2 json, if it can be loaded as json.
'''
import argparse
import json

def main(args):
    f = args.ifile
    s = json.loads(open(f).read())
    sout = json.dumps(s, indent=2)
    open(f, 'w').write(sout)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ifile', help='json file to indent')
    args = parser.parse_args()

    main(args)
