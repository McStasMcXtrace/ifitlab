import engintf

class _IFitObject(engintf.ObjReprJson):
    def _varname(self):
        return 'obj_%d' % id(self)

class IData(_IFitObject):
    def get_repr(self):
        return self._get_full_repr_dict()
    def rmint(self, p1:list, p2:list):
        pass

class IFunc(_IFitObject):
    def get_repr(self):
        return self._get_full_repr_dict()
    def guess(self, parvals:list):
        pass
    def fixp(self, fixps:list):
        pass

class Lorzpp(IFunc):
    @staticmethod
    def non_polymorphic_typename():
        return 'IFunc'
    def _modelsymbol(self):
        return 'lorzpp'

def comb(files:list, rank:int=0) -> IData:
    pass

def fit(idata: IData, ifunc: IFunc) -> IFunc:
    pass
