'''
General directed graph execution engine with variable node types, custom
node execution models, dynamic graph consistency checking and egalitarian and
hierarchical graph structure (graphtree).
'''
__author__ = "Jakob Garde"

import inspect

'''
List-based parents/children data structure enabling unique parents, but multiple children, of the same order and idx.

NOTE: "Order" refers to a "vertical" execution order, not the order of arguments in a function call. 
It can be ignored for most purposes.
'''
def child_put(lst, item, idx, order):
    lst.append((item, idx, order))
def children_get(lst, order):
    srtd = sorted(lst, key=lambda i: i[1])
    return [l[0] for l in srtd if l[2]==order]
def child_rm(lst, item, idx, order):
    try:
        del lst[lst.index((item, idx, order))]
    except:
        raise Exception("item, idx(%s), order(%s) not found in lst" % (idx, order))
def parent_put(lst, item, idx, order):
    idxs_of_order = [l[1] for l in lst if l[2]==order]
    if idx in idxs_of_order:
        raise Exception('some item of idx "%s" at order "%s" already exists' % (idx , order))
    lst.append((item, idx, order))
def parents_get(lst, order):
    srtd = sorted(lst, key=lambda i: i[1])
    return [l[0] for l in srtd if l[2]==order]
def parent_rm(lst, item, idx, order):
    try:
        del lst[lst.index((item, idx, order))]
    except:
        raise Exception("item, idx(%s), order(%s) not found in lst" % (idx, order))
def child_or_parent_rm_allref(lst, item):
    todel = [l for l in lst if l[0]==item]
    for l in todel:
        del lst[lst.index(l)]


'''
Base node types.
'''
class NodeNotExecutableException(Exception): pass
class InternalExecutionException(Exception):
    def __init__(self, name, msg=None):
        self.name = name
        super().__init__(msg)

class GraphInconsistenceException(Exception): pass
class AbstractMethodException(Exception): pass

class Node:
    class RemoveParentIdxInconsistencyException(Exception): pass
    class RemoveChildIdxInconsistencyException(Exception): pass
    class NodeOfNameAlreadyExistsException(Exception): pass
    class NoNodeOfNameExistsException: pass
    def __init__(self, name, exe_model):
        self.name = name
        self.exe_model = exe_model

        self.children = []
        self.parents = []
        self.owners = []
        self.subnodes = {}

    def graph_inconsistent_fail(self, message):
        raise GraphInconsistenceException('(%s %s): %s' % (type(self).__name__, self.name, message))

    ''' Graph connectivity interface '''
    def add_child(self, node, idx, order=0):
        if node in [n for n in children_get(self.children, order)]:
            raise Node.NodeOfNameAlreadyExistsException()
        if not self._check_child(node):
            self.graph_inconsistent_fail("illegal add_child")
        child_put(self.children, node, idx, order)
    def remove_child(self, node, idx=None, order=0):
        if idx is None:
            child_or_parent_rm_allref(self.children, node)
        else:
            child_rm(self.children, node, idx, order)
    def num_children(self, order=None):
        if order == None:
            # cheat and include 1st and 2nd order
            return len(children_get(self.children, 0)) + len(children_get(self.children, 1))
        else:
            return len( children_get(self.children, order) )

    def add_parent(self, node, idx, order=0):
        if node in [n for n in parents_get(self.parents, order)]:
            raise Node.NodeOfIdAlreadyExistsException()
        if not self._check_parent(node):
            self.graph_inconsistent_fail('illegal add_parent')
        parent_put(self.parents, node, idx, order)
    def remove_parent(self, node, idx=None, order=0):
        if idx is None:
            child_or_parent_rm_allref(self.parents, node)
        else:
            parent_rm(self.parents, node, idx, order)
    def num_parents(self, order=None):
        if order == None:
            # cheat and include 1st and 2nd order
            return len(parents_get(self.parents, 0)) + len(parents_get(self.parents, 1))
        else:
            return len( parents_get(self.parents, order) )

    def subnode_to(self, node):
        if not self._check_owner(node):
            self.graph_inconsistent_fail('illegal subnode_to')
        self.owners.append(node)
    def unsubnode_from(self, node):
        if node in self.owners:
            self.owners.remove(node)

    def own(self, node):
        if not self._check_subnode(node):
            self.graph_inconsistent_fail('illegal own')
        if node.name not in self.subnodes.keys():
            self.subnodes[node.name] = node
        else:
            raise Node.NodeOfIdAlreadyExistsException()
    def disown(self, node):
        if node.name in self.subnodes.keys():
            del self.subnodes[node.name]
        else:
            raise Node.NoNodeOfNameExistsException()

    ''' Graph consistence. Implement to define conditions on graph consistency, throw a GraphInconsistenceException. '''
    def _check_subnode(self, node):
        pass
    def _check_owner(self, node):
        pass
    def _check_child(self, node):
        pass
    def _check_parent(self, node):
        pass

    ''' Subject/Object execution interface '''
    def assign(self, node):
        raise AbstractMethodException()
    def call(self, *args):
        raise AbstractMethodException()
    def get_object(self):
        raise AbstractMethodException()

    ''' Execution model interface '''
    def exemodel(self):
        return self.exe_model

class ExecutionModel():
    ''' Subclass to implement all methods. '''
    class CallAndAssignException(Exception): pass
    def order(self):
        raise AbstractMethodException()
    def can_assign(self):
        raise AbstractMethodException()
    def can_call(self):
        raise AbstractMethodException()
    def objects(self):
        raise AbstractMethodException()
    def subjects(self):
        raise AbstractMethodException()
    def check(self):
        if self.can_assign() and self.can_call():
            raise ExecutionModel.CallAndAssignException()


'''
Generic node types.
'''

class RootNode(Node):
    ''' Used as a passive "owning" node. Can accept any child or parent as a sub-node. '''
    class ExeModel(ExecutionModel):
        ''' A model that does nothing. '''
        def order(self):
            return -1
        def can_assign(self):
            return False
        def can_call(self):
            return False
        def objects(self):
            return ()
        def subjects(self):
            return ()

    def __init__(self, name):
        super().__init__(name, exe_model=RootNode.ExeModel())
    def _check_subnode(self, node):
        return True
    def _check_owner(self, node):
        return True
    def _check_child(self, node):
        return False
    def _check_parent(self, node):
        return False

'''
Programming style node types.

For example:
ObjNode, a handle for objects returned by FuncNodes or otherwise
FuncNode is intended to be used as pure functions as given by the functional paradigm
MethodNode, intended to bring object interaction to the node graph through direcly calling methods.
ReturnFuncNode, returns the value of a boolean evaluation, to be used in conjunction with flow controls
'''

class ObjNode(Node):
    ''' An object handle. '''
    class CallException(Exception): pass
    class ExeModel(ExecutionModel):
        def order(self):
            return 0
        def can_assign(self):
            return True
        def can_call(self):
            return False
        def objects(self):
            return standard_objects
        def subjects(self):
            return standard_subjects

    def __init__(self, name, obj=None):
        self.obj = obj
        super().__init__(name, exe_model=type(self).ExeModel())

    def assign(self, obj):
        self.obj = obj
        for m in [node for node in list(self.subnodes.values()) if type(node) is MethodNode]:
            m._check_owner(self)
    def call(self, *args):
        raise ObjNode.CallException()
    def get_object(self):
        return self.obj

    def _check_subnode(self, node):
        return type(node) is MethodNode
    def _check_owner(self, node):
        return type(node) is RootNode
    def _check_child(self, node):
        return type(node) in standard_children
    def _check_parent(self, node):
        return type(node) in standard_parents and len( parents_get(self.parents, self.exe_model.order()) ) < 1

class ObjLiteralNode(ObjNode):
    ''' Holds a literal (often json) object intended to be editable through a ui '''
    class ExeModel(ExecutionModel):
        def order(self):
            return 0
        def can_assign(self):
            ''' This does not mean that you can't assign, but the execution function! '''
            return False
        def can_call(self):
            return False
        def objects(self):
            return [ObjLiteralNode]
        def subjects(self):
            return []
    def _check_parent(self, node):
        return False

class RootNodeForwardingObj(Node):
    '''
    A root node which forwards its execution and connectivity to a certain subnode. Can be used as a
    crude way to model inter-level connections, that works for subnode assemblies with precisely
    one obj subnode.
    '''
    class CallException(Exception): pass
    class MoreThanOneObjSubnodeException(Exception): pass
    class ExeModel(ExecutionModel):
        def order(self):
            return 0
        def can_assign(self):
            return True
        def can_call(self):
            return False
        def objects(self):
            return standard_objects
        def subjects(self):
            return standard_subjects
    
    def __init__(self, name):
        super().__init__(name, exe_model=RootNodeForwardingObj.ExeModel())
    
    def assign(self, obj):
        lst = []
        for name in self.subnodes.keys():
            subn = self.subnodes[name]
            if type(subn) in (ObjNode, RootNodeForwardingObj):
                lst.append(subn)
        if len(lst) == 1:
            lst[0].assign(obj)
        elif len(lst) == 0:
            raise RootNodeForwardingObj.NoObjSubnodesException()
        else:
            raise RootNodeForwardingObj.MoreThanOneObjSubnodeException()
    def call(self, *args):
        raise RootNodeForwardingObj.CallException()
    def get_object(self):
        lst = []
        for name in self.subnodes.keys():
            subn = self.subnodes[name]
            if type(subn) in (ObjNode, RootNodeForwardingObj):
                lst.append(subn)
        if len(lst) == 1:
            return lst[0].get_object()
        elif len(lst) == 0:
            raise RootNodeForwardingObj.NoObjSubnodesException()
        else:
            raise RootNodeForwardingObj.MoreThanOneObjSubnodeException()
    
    def _check_subnode(self, node):
        return True
    def _check_owner(self, node):
        return type(node) is RootNode
    def _check_child(self, node):
        return type(node) in standard_children
    def _check_parent(self, node):
        return type(node) in standard_parents and len( parents_get(self.parents, self.exe_model.order()) ) < 1

class FuncNode(Node):
    ''' Holds a fixed function, with no direct execution allowed. '''
    class ExeModel(ExecutionModel):
        # this model is inactive
        def order(self):
            return -1
        def can_assign(self):
            return False
        def can_call(self):
            return False
        def objects(self):
            return []
        def subjects(self):
            return []

    def __init__(self, name, func):
        self.func = func
        super().__init__(name, exe_model=FuncNode.ExeModel())
        # default value parameters are not represented in the graph, but as a configuration option
        self.defaults = {}
        sign = inspect.signature(func)
        for k in sign.parameters.keys():
            par = sign.parameters[k]
            if par.default != inspect._empty:
                self.defaults[k] = par.default
    def assign(self, obj):
        if type(obj) not in (dict, ):
            raise Exception("only do call FuncNode.assign with a dict")
        for k in obj.keys():
            if k in self.defaults:
                self.defaults[k] = obj[k]
    def call(self, *args):
        try:
            return self.func(*args, **self.defaults)
        except Exception as e:
            raise InternalExecutionException(self.name, str(e))
    def get_object(self):
        return self.defaults

    def _check_subnode(self, node):
        return False
    def _check_owner(self, node):
        return type(node) is RootNode
    def _check_child(self, node):
        return type(node) in standard_children
    def _check_parent(self, node):
        return type(node) in standard_parents and True

class MethodNode(Node):
    ''' Represents a method reference on some object, requires an ObjNode owner. '''
    class OwnerNotAssignedException(Exception): pass
    class NoMethodOfThatNameException(Exception): pass
    class AssignException(Exception): pass
    class ExeModel(ExecutionModel):
        def order(self):
            return 0
        def can_assign(self):
            return False
        def can_call(self):
            return True
        def objects(self):
            return standard_objects
        def subjects(self):
            return standard_subjects

    def __init__(self, name, methodname):
        self.methodname = methodname
        super().__init__(name, exe_model=MethodNode.ExeModel())
    def assign(self, obj):
        raise MethodNode.AssignException()
    def call(self, *args):
        ''' returns None if the owner node's object is None '''
        last = None
        for o in self.owners:
            if type(o) is ObjNode:
                method = None
                try:
                    method = getattr(o.get_object(), self.methodname)
                except:
                    raise MethodNode.NoMethodOfThatNameException()
                try:
                    last = method(*args)
                except Exception as e:
                    raise InternalExecutionException(self.name, str(e))
        return last

    def _check_subnode(self, node):
        return False
    def _check_owner(self, node):
        return type(node) in (ObjNode, RootNode)
    def _check_child(self, node):
        return type(node) in standard_children and True
    def _check_parent(self, node):
        return type(node) in standard_parents and True

class MethodAsFunctionNode(Node):
    ''' Akin to FuncNode, but with first argument 'self'. Calls its "func target" string as a method on 'self'. '''
    def __init__(self, name, methodname):
        self.methodname = methodname
        super().__init__(name, exe_model=MethodNode.ExeModel())
        # default value parameters are not represented in the graph, but as a configuration option
        self.defaults = {}
    def assign(self, obj):
        if type(obj) not in (dict, ):
            raise Exception("only do call FuncNode.assign with a dict")
        for k in obj.keys():
            # we have to assume that they are assigning something meaningful - otherwise call() will fail (a check could be implemented though)
            self.defaults[k] = obj[k]
    def call(self, *args):
        slf = args[0]
        realargs = args[1:]
        method = None
        try:
            method = getattr(slf, self.methodname)
            # the default args trick has to be applied on-the-fly, keeping in assign(dct) in mind
            sign = inspect.signature(method)
            for k in sign.parameters.keys():
                par = sign.parameters[k]
                if par.default != inspect._empty:
                    if par._name not in self.defaults.keys():
                        self.defaults[k] = par.default
        except:
            raise MethodNode.NoMethodOfThatNameException()
        try:
            return method(*realargs, **self.defaults)
        except Exception as e:
            raise InternalExecutionException(self.name, str(e))

    def get_object(self):
        return self.methodname

    def _check_subnode(self, node):
        return False
    def _check_owner(self, node):
        return type(node) is RootNode
    def _check_child(self, node):
        return type(node) in standard_children and True
    def _check_parent(self, node):
        return type(node) in standard_parents and True

class ReturnFuncNode(Node):
    ''' Callable node, which holds a function returning a bool or N_0 int. Can not have child nodes. '''
    class AssignException(Exception): pass
    class ExeModel(ExecutionModel):
        def order(self):
            return 0
        def can_assign(self):
            return False
        def can_call(self):
            return True
        def objects(self):
            return standard_objects
        def subjects(self):
            return standard_subjects

    def __init__(self, name, func=None):
        self.func = func
        super().__init__(name, exe_model=ReturnFuncNode.ExeModel())

    def assign(self, obj):
        raise ReturnFuncNode.AssignException()
    def call(self, *args):
        if self.func:
            try:
                return self.func(*args)
            except Exception as e:
                raise InternalExecutionException(self.name, str(e))
        else:
            '''_not_none default behavior '''
            if len(args) > 0:
                return args[0] is not None
    def _check_subnode(self, node):
        return False
    def _check_owner(self, node):
        return type(node) is RootNode
    def _check_child(self, node):
        return False
    def _check_parent(self, node):
        return type(node) in standard_children and True

standard_children = (FuncNode, ObjNode, MethodNode, ReturnFuncNode, MethodAsFunctionNode)
standard_parents = (FuncNode, ObjNode, ObjLiteralNode, MethodNode, MethodAsFunctionNode)
standard_objects = (ObjNode, ObjLiteralNode, RootNodeForwardingObj)
standard_subjects = (FuncNode, MethodNode, MethodAsFunctionNode)

'''
Node graph operations.
'''
def add_subnode(root, node):
    root.own(node)
    node.subnode_to(root)

def remove_subnode(root, node):
    root.disown(node)
    node.unsubnode_from(root)

def add_connection(node1, idx1, node2, idx2, order=0):
    node1.add_child(node2, idx1, order)
    node2.add_parent(node1, idx2, order)

def remove_connection(node1, idx1, node2, idx2, order=0):
    node1.remove_child(node2, idx1, order)
    node2.remove_parent(node1, idx2, order)

def del_node(node):
    ''' disconnect a node and recursively disconnect all its subnodes '''
    for c in node.children:
        remove_connection(node, c)
    for p in node.parents:
        remove_connection(p, node)
    for s in node.subnodes:
        del_node(s)
    if node.owner:
        remove_subnode(node.owner, node)

'''
Node graph engine execution.
'''
def execute_node(node):
    '''
    Executes a node by means of directed graph subtree building and evaluation, depending on the 
    node's connectivity and its execution model.
    Returns the result of the subtree evaluation, which can be None.
    '''
    def build_subtree(root):
        '''
        Recursively builds a subtree from the graph consisting of a root (tree[0], possibly None), and 0-2 elements.
        '''
        def build_subtree_recurse(node, tree, model):
            subjs = model.subjects()
            objs = model.objects()
            for p in parents_get(node.parents, model.order()):
                if type(p) in subjs:
                    tree.append(p)
                    tree.append(build_subtree_recurse(p, [], model))
                elif type(p) in objs:
                    tree.append(p)
            return tree

        model = root.exemodel()
        tree = build_subtree_recurse(root, [], model)
        # for "object calls" e.g. obj or "func as functional output"
        if model.can_assign():
            tree.insert(0, root)
            return tree
        # for "subject call" e.g. returnfunc
        elif model.can_call():
            return [None, root, tree]
        else:
            raise NodeNotExecutableException()

    def call_subtree(tree):
        '''
        Recursively calls nodes in a subtree, built by the build_subtree function.

        If the root (tree[0]) is not None, assignment to this node is carried out after call recursion.
        The result value of the call recursion is always returned.

        Disregarding the tree root, a pair of elements, consisting of a subject node and a list (an arg-list),
        signals a call recursion. Elements in that list can be singular object nodes or pairs of a subject 
        node and an arg-list.
        - During call recursion, Object nodes in argument lists are replaced with their values.
        - During recursion, (Subject node, arg-list) pairs are recursively reduced to values. This recursive 
        evaluation begins at the end branches.
        '''
        def call_recurse(f, argtree):
            i = 0
            while i < len(argtree):
                if i + 1 < len(argtree) and type(argtree[i+1]) == list:
                    f_rec = argtree[i]
                    argtree_rec = argtree[i+1]
                    value = call_recurse(f_rec, argtree_rec)
                    del argtree[i]
                    argtree[i] = value
                else:
                    value = argtree[i].get_object()
                    argtree[i] = value
                i += 1
            return f.call(*argtree)

        root = tree[0]
        del tree[0]

        result = None
        if len(tree) == 0:
            result = None
            if root: root.assign(result)
        elif len(tree) == 1:
            result = tree[0].get_object()
            if root: root.assign(result)
        else:
            func = tree[0]
            args = tree[1]
            result = call_recurse(func, args)
            if root: root.assign(result)
        return result

    subtree = build_subtree(node)
    return call_subtree(subtree)

