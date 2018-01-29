'''
General directed graph execution engine with variable node and connection types, custom
node execution models, dynamic graph consistence checking, egalitarian and
hierarchical structure.
'''
__author__ = "Jakob Garde"

''' list based parents/children datastructure allowing for unique parents, but multiple children, of the same order and idx '''
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
Abstract node types.
'''

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

    ''' Graph consistence. Implement to define conditions on graph consistence, throw a GraphInconsistenceException. '''
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
    ''' Used as a passive "owning" node at various levels. Can accept any child or parent as a subnode. '''
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

ObjNode - handles for objects returned by FuncNodes or otherwise
FuncNode - intended to be used as pure functions
MethodNode - intended to bring object interaction to the node graph
ReturnFuncNode - intended for boolean evaluation in conjunction with flow controls
'''

class ObjNode(Node):
    ''' Holds an OOP object or data object. '''
    class CallException(Exception): pass
    class ExeModel(ExecutionModel):
        def order(self):
            return 0
        def can_assign(self):
            return True
        def can_call(self):
            return False
        def objects(self):
            return [ObjNode, ObjLitteralNode]
        def subjects(self):
            return [FuncNode, MethodNode, MethodAsFunctionNode]

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
        return type(node) in (FuncNode, ObjNode, MethodNode, ReturnFuncNode, MethodAsFunctionNode)
    def _check_parent(self, node):
        return type(node) in (FuncNode, ObjNode, ObjLitteralNode, MethodNode, MethodAsFunctionNode) and len( parents_get(self.parents, self.exe_model.order()) ) < 1

class ObjLitteralNode(ObjNode):
    ''' Holds a json object edited by the user '''
    class ExeModel(ExecutionModel):
        def order(self):
            return 0
        def can_assign(self):
            ''' This does not mean that you can't assign, but the execution function! '''
            return False
        def can_call(self):
            return False
        def objects(self):
            return [ObjLitteralNode]
        def subjects(self):
            return []
    def _check_parent(self, node):
        return False

class FuncNode(Node):
    ''' Holds a fixed function, no execution available. '''
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
            # TODO: add first-order subjects here! Till then, we can only assign directly from another FuncNode
            return []

    def __init__(self, name, func):
        self.func = func
        super().__init__(name, exe_model=FuncNode.ExeModel())

    def assign(self, obj):
        if callable(obj):
            self.func = obj;
    def call(self, *args):
        return self.func(*args)
    def get_object(self):
        return self.func

    def _check_subnode(self, node):
        return False
    def _check_owner(self, node):
        return type(node) is RootNode
    def _check_child(self, node):
        return type(node) in (FuncNode, ObjNode, MethodNode, ReturnFuncNode, MethodAsFunctionNode)
    def _check_parent(self, node):
        return type(node) in (FuncNode, ObjNode, ObjLitteralNode, MethodNode, MethodAsFunctionNode) and True

class FuncObj(Node):
    ''' base node type stub, will become the "functional object" type '''
    pass

class MethodNode(Node):
    ''' Holds an OOP object method reference, requires ObjNode owner(s). '''
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
            return [ObjNode, ObjLitteralNode]
        def subjects(self):
            return [FuncNode, MethodNode, MethodAsFunctionNode]

    def __init__(self, name, methodname):
        ''' NOTE: This node type must be born with an owner, and has a restricted name, given by its owners name and method name. '''
        self.methodname = methodname
        super().__init__(name, exe_model=MethodNode.ExeModel())
    def assign(self, obj):
        raise MethodNode.AssignException()
    def call(self, *args):
        ''' note that calls with cold obj owners does not raise any errors, but returns None (which many method calls may do anyway) '''
        last = None
        for o in self.owners:
            if type(o) is ObjNode:
                try:
                    last = getattr(o.get_object(), self.methodname)(*args)
                except:
                    raise MethodNode.NoMethodOfThatNameException()
        return last

    def _check_subnode(self, node):
        return False
    def _check_owner(self, node):
        ''' note that we allow assignment to "cold" obj nodes '''
        return type(node) in (ObjNode, RootNode)
    def _check_child(self, node):
        return type(node) in (FuncNode, ObjNode, MethodNode, ReturnFuncNode, MethodAsFunctionNode) and True
    def _check_parent(self, node):
        return type(node) in (FuncNode, ObjNode, ObjLitteralNode, MethodNode, MethodAsFunctionNode) and True

class MethodAsFunctionNode(Node):
    ''' Alike to FuncNode, but with first argument 'self'. Applies functarget as a method on that object. '''
    def __init__(self, name, methodname):
        self.methodname = methodname
        super().__init__(name, exe_model=MethodNode.ExeModel())

    def assign(self, obj):
        if callable(obj):
            self.methodname = obj;
    def call(self, *args):
        slf = args[0]
        realargs = args[1:]
        return getattr(slf, self.methodname)(*realargs)
    def get_object(self):
        return self.methodname

    def _check_subnode(self, node):
        return False
    def _check_owner(self, node):
        return type(node) is RootNode
    def _check_child(self, node):
        return type(node) in (FuncNode, ObjNode, MethodNode, ReturnFuncNode, MethodAsFunctionNode) and True
    def _check_parent(self, node):
        return type(node) in (FuncNode, ObjNode, ObjLitteralNode, MethodNode, MethodAsFunctionNode) and True

class ReturnFuncNode(Node):
    ''' Callable node which holds a function returning a bool or N_0 int. Cannot have any children. '''
    class AssignException(Exception): pass
    class ExeModel(ExecutionModel):
        def order(self):
            return 0
        def can_assign(self):
            return False
        def can_call(self):
            return True
        def objects(self):
            return [ObjNode]
        def subjects(self):
            return [FuncNode, MethodNode, MethodAsFunctionNode]

    def __init__(self, name, func=None):
        self.func = func
        super().__init__(name, exe_model=ReturnFuncNode.ExeModel())

    def assign(self, obj):
        raise ReturnFuncNode.AssignException()
    def call(self, *args):
        if self.func:
            return self.func(*args)
        else:
            ''' is_not_none default behavior '''
            if len(args) > 0:
                return args[0] is not None
    def _check_subnode(self, node):
        return False
    def _check_owner(self, node):
        return type(node) is RootNode
    def _check_child(self, node):
        return False
    def _check_parent(self, node):
        return type(node) in (FuncNode, ObjNode, ObjLitteralNode, MethodNode, MethodAsFunctionNode) and True

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
    ''' completely disconnect a node and all its subnodes '''
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
class NodeNotExecutableException(Exception): pass
def execute_node(node):
    '''
    Executes a node by means of directed graph subtree build and evaluation, depending on the node's connectivity
    "as an object" in the graph, as given by its execution model.
    Always returns the result of the subtree evaluation, even if it is None or trivial.
    '''
    def build_subtree(root):
        '''
        Recursively builds a subtree from the graph consisting of a root (tree[0], possibly None), and 0-2 elements.
        0: Trivial subtree.
        1: object assignment.
        2: function assignment.
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

        If the root (tree[0]) is not None, assignment is carried out after call recursion. The result value
        of the call recursion is always returned.

        Disregarding the tree root, a pair of elements consisting of a subject node and a list, signals a call
        recursion. Elements in such a list can be either singular object nodes, or pairs of a subject node and a list.
        - Object nodes in such a "argument list" are replaced with their values.
        - Subject node-list pairs are recursively reduced to output values of the subject as a function, which can
        be evaluated at lists consisting solely of values. This recursive evalueation starts at the end branches.
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
            result = tree[0]
            if root: root.assign(result)
        else:
            func = tree[0]
            args = tree[1]
            result = call_recurse(func, args)
            if root: root.assign(result)
        return result

    subtree = build_subtree(node)
    return call_subtree(subtree)

def inspect_node(node):
    '''
    Used for inspecting nodes as handles to an object, given that the node can be considered an object.
    This is given by its execution model and implementation.
    '''
    return node.get_object()
