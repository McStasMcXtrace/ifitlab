'''
Generates "flatext" node type confs from a python module.
'''
from django.core.management.base import BaseCommand

import importlib
import json

import enginterface

def ctypeconf_ifitlib(tree, addrss):
    '''
    The ifitlib specific part of node conf generation.
    tree - the conf tree
    addrss - the conf addresses associated
    '''
    def get_key(conf):
        return conf['type']

    # object_idata
    idata = enginterface.NodeConfig()
    idata.docstring = "IData object handle."
    idata.type = 'idata'
    idata.address = '.'.join(['handles', 'idata'])
    idata.basetype = 'object_idata'
    # superfluous?
    idata.itypes = ['IData']
    # superfluous?
    idata.otypes = ['IData']
    idata.static = 'false'
    idata.executable = 'true'
    idata.edit = 'false'
    idata.name = 'idata'
    tree.put('handles', idata.get_repr(), get_key)
    addrss.insert(1, idata.address)

    # object_ifunc
    ifunc = enginterface.NodeConfig()
    ifunc.docstring = "IFunc object handle."
    ifunc.type = 'ifunc'
    ifunc.address = '.'.join(['handles', 'ifunc'])
    ifunc.basetype = 'object_ifunc'
    # superfluous?
    ifunc.itypes = ['IFunc']
    # superfluous?
    ifunc.otypes = ['IFunc']
    ifunc.static = 'false'
    ifunc.executable = 'true'
    ifunc.edit = 'false'
    ifunc.name = 'ifunc'
    tree.put('handles', ifunc.get_repr(), get_key)
    
    addrss.insert(2, ifunc.address)


class Command(BaseCommand):
    help = ''

    def add_arguments(self, parser):
        # adduser(dn, admin_password, cn, sn, uid, email, pw)
        parser.add_argument('python_module', nargs=1, type=str, help='python module to apply node type extraction to')
        parser.add_argument('python_package', nargs=1, type=str, help='package containing python_module')

    def handle(self, *args, **options):
        print('running gen_types on module "%s"' % options["python_module"][0])

        mdl = importlib.import_module(options["python_module"][0], options["python_package"][0])
        namecategories = getattr(mdl, "namecategories")

        clss, fcts = enginterface.get_nodetype_candidates(mdl)
        tree, addrss, categories = enginterface.ctypeconf_tree_ifit(clss, fcts, namecategories)
        
        # ifitlib specific part ...
        ctypeconf_ifitlib(tree, addrss)

        enginterface.save_nodetypes_js('fitlab/static/fitlab', tree, addrss, categories)
        enginterface.save_modulename_json(options["python_module"][0], options["python_package"][0])

