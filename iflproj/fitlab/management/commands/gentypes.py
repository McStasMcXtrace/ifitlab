'''
Generates node type configurations from a python module.
'''
from django.core.management.base import BaseCommand

import importlib
import json

import enginterface
from fitlab.models import GraphSession

def insert_typeconf_ifl(tree, addrss):
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
    help = 'Generates node type configurations from a python module.'

    def handle(self, *args, **options):
        try:
            print("WARNING: make sure the worker isn't running, gentypes may change graph defs and reset instances.")

            # step 0 - enter python package and module
            userpkg = input("package:")
            usermdl = input("module:")

            # step 1 - extract node types from the given module
            print('extracting types from module "%s"...' % usermdl)
            mdl = importlib.import_module(usermdl, userpkg)
            namecategories = getattr(mdl, "namecategories")
            clss, fcts = enginterface.get_nodetype_candidates(mdl)
            typetree, addresses, categories = enginterface.ctypeconf_tree_ifit(clss, fcts, namecategories)
            insert_typeconf_ifl(typetree, addresses)

            # step 2 - look through existing graph defs to check for node addresses that aren't 
            #          in the new gen and prompt the user if required.
            fixes = dict()
            issues = 0
            sessions = GraphSession.objects.all()
            for s in sessions:
                gd = json.loads(s.graphdef)
                hasissues = False
                print("checking session %s" % s.id)
                for id in list(gd["nodes"]):
                    address = gd["nodes"][id][5]
                    if address in addresses:
                        # the address exists
                        continue
                    else:
                        hasissues = True
                        # fix or delete this node
                        if address not in fixes:
                            fixes[address] = input("input substitute address for %s (empty = delete): " % address)
                        if fixes[address] != "":
                            gd["nodes"][id][5] = fixes[address]
                        else:
                            del gd["nodes"][id]
                        print("'%s' --> '%s'" % (address, fixes[address]))

                        # bust all links to and from this node
                        for nfrom in list(gd["links"]):
                            if nfrom == id:
                                # delete the whole set of exit links from this id
                                del gd["links"][nfrom]
                                continue
                            else:
                                links = gd["links"][nfrom]
                                for lcmd in links:
                                    if lcmd[2] == id:
                                        # delete thisspecific entry link
                                        links.remove(lcmd)

                # save any changes
                if hasissues:
                    issues = issues +1
                    s.reset()
                    s.graphdef = json.dumps(gd)

            if issues > 0:
                input("about to save %d fixed graphs (ctrl-C to exit)..." % issues)
            else:
                print("no graph def issues found")
            for s in sessions:
                s.save()

        except KeyboardInterrupt:
            print("exiting...")
            quit()

        print("generating nodetypes.js and pmodule.js")
        enginterface.save_nodetypes_js('fitlab/static/fitlab', typetree, addresses, categories)
        enginterface.save_modulename_json(usermdl, userpkg)

