'''
iFit-interfaced library used as a base for generating ifitlab node types.
'''
__author__ = "Jakob Garde"

import logging

from engintf import ObjReprJson
from matlab import Matlab

logging.basicConfig(level=logging.DEBUG)


'''
matlab interface instance global
'''
mintface = Matlab('ifit')


class IFitObject(ObjReprJson):
    ''' implements a way to pass on the varnames between instances '''
    def varname(self):
        return 'obj_%d' % id(self)

class IData(IFitObject):
    def __init__(self, url: str):
        logging.debug("IData.__init__('%s')" % url)

        self.url = url
        vn = self.varname()
        if url==None:
            '''
            NOTE: This branch (url==None) is to be used only programatically, as a "prepper" intermediary
            state to get a varname from python, before assigning an actual ifit object, for example while
            executing (the python-side bookkeeping of) functions like fits or eval.
            '''
            pass
        else:
            mintface.eval("%s = iData('%s');" % (vn, url))

    def _get_plot(self, x, y, yerr, xlabel, ylabel, title):
        ''' returns the dict required by the svg 1d plotting function '''
        #WIDTH = 700
        #HEIGHT = 480
        WIDTH = 326
        HEIGHT = 220

        params = {}
        p = params
        p['w'] = WIDTH
        p['h'] = HEIGHT
        p['x'] = x
        p['y'] = y
        p['yerr'] = yerr
        p['xlabel'] = xlabel
        p['ylabel'] = ylabel
        p['title'] = title

        return params

    def get_repr(self):
        retdct = self._get_full_repr_dict()
        try:
            vn = self.varname()
            signal = mintface.get('%s.Signal' % vn).tolist()
            error = mintface.get('%s.Error' % vn).tolist()
            # NOTE: what does this refer to?
            # monitor = np.array(self.eng.eval('%s.Monitor' % varname))

            axes_name = mintface.get('%s.Axes' % vn)
            firstaxes_vals = mintface.get('%s.%s' % (vn, axes_name)).tolist()

            pltdct = self._get_plot(x=firstaxes_vals, y=signal, yerr=error, xlabel='x', ylabel='y', title=self.varname())

            infdct = {}
            infdct['ndims'] = mintface.get('ndims(%s)' % vn)

            retdct['plotdata'] = pltdct
            retdct['info'] = infdct

        except Exception as e:
            infdct = {}
            infdct['error'] = 'IData.get_repr failed ("%s")' % str(e)
            retdct['info'] = infdct

        return retdct

    def __exit__(self, exc_type, exc_value, traceback):
        cmd = "clear %s;" % self.varname()
        #logging.debug("running ifit command: %s" % cmd)
        mintface.eval(cmd)

class IFunc(IFitObject):
    def _modelsymbol(self):
        return 'iFunc'

    def __init__(self):
        logging.debug("%s.__init__" % str(type(self)))
        vn = self.varname()
        symb = self._modelsymbol()
        mintface.eval("%s = %s();" % (vn, symb))
        mintface.eval('%s([]);' % vn) # this hack makes the symbol '.p' available in ifit on the ifunc object

    def get_repr(self):
        vn = self.varname()

        pkeys = mintface.get('%s.Parameters' % vn).tolist()
        pvals = mintface.get('%s.p' % vn).tolist()

        params = {}
        for key in pkeys:
            idx = pkeys.index(key)
            params[key] = pvals[idx]

        retdct = self._get_full_repr_dict()
        retdct['userdata'] = params
        return retdct

    def set_user_data(self, json_obj):
        # this would be the 'userdata' branch ...
        vn = self.varname()
        params = mintface.get('%s.Parameters' % vn).tolist()

        for key in params:
            # some keys contain whitespaces, and can not be used as "struct properties" in matlab
            try:
                val = json_obj[key]
                mintface.eval('p_%s.%s = %s;' % (vn, key, val))
            except:
                print('IFunc.set_user_data: set failed for param "%s" to val "%s"' % (key, val))
                continue
        mintface.eval('%s(p_%s);' % (vn, vn))
        mintface.eval('clear p_%s;' % vn)
        pass

    def __exit__(self, exc_type, exc_value, traceback):
        cmd = "clear %s;" % self.varname()
        #logging.debug("running ifit command: %s" % cmd)
        mintface.eval(cmd)

class Gauss(IFunc):
    def _modelsymbol(self):
        return 'gauss'

class Lorentz(IFunc):
    def _modelsymbol(self):
        return 'lorz'

class Lin(IFunc):
    def _modelsymbol(self):
        return 'strline'


'''
IFunc operators: Take two or more ifunc objects and combine them into a third. (Thdese are actually functions.)
'''
# TODO: add typehints
def add(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    logging.debug("add: %s, %s" % (ifunc_a, ifunc_b))
    vn1 = ifunc_a.varname()
    vn2 = ifunc_b.varname()
    obj = IFunc()
    vn_new = obj.varname()
    mintface.eval('%s = %s + %s;' % (vn_new, vn1, vn2))
    return obj

def subtr(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    logging.debug("subtr: %s, %s" % (ifunc_a, ifunc_b))
    vn1 = ifunc_a.varname()
    vn2 = ifunc_b.varname()
    obj = IFunc()
    vn_new = obj.varname()
    mintface.eval('%s = %s - %s;' % (vn_new, vn1, vn2))
    return obj

def mult(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    logging.debug("mult: %s, %s" % (ifunc_a, ifunc_b))
    vn1 = ifunc_a.varname()
    vn2 = ifunc_b.varname()
    obj = IFunc()
    vn_new = obj.varname()
    mintface.eval('%s = %s * %s;' % (vn_new, vn1, vn2))
    return obj

def div(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    logging.debug("div: %s, %s" % (ifunc_a, ifunc_b))
    vn1 = ifunc_a.varname()
    vn2 = ifunc_b.varname()
    obj = IFunc()
    vn_new = obj.varname()
    mintface.eval('%s = %s / %s;' % (vn_new, vn1, vn2))
    return obj

def trapz(ifunc: IFunc) -> IFunc:
    logging.debug("trapz: %s" % ifunc)
    vn_old = ifunc.varname()
    obj = IFunc()
    vn_new = obj.varname()
    mintface.eval('%s = trapz(%s)' % (vn_new, vn_old))
    return obj

'''
ifit functions
'''
# TODO: add typehints
def eval(idata: IData, ifunc: IFunc) -> IData:
    ''' IData, IFunc -> IData  '''
    logging.debug("eval: %s, %s" % (idata, ifunc))
    vn_olddata = idata.varname()
    vn_func = ifunc.varname()
    retobj = IData(None)
    vn_newdata = retobj.varname()
    # TODO: find a way to clone idata objects
    #mintface.eval('%s = copyobj(%s)(%s);' % (vn_newdata, vn_olddata, vn_func))
    mintface.eval('%s = %s(%s);' % (vn_newdata, vn_olddata, vn_func))
    return retobj

def fit(idata: IData, ifunc: IFunc) -> IFunc:
    ''' IData, IFunc -> IFunc '''
    logging.debug("fit: %s, %s" % (idata, ifunc))
    vn_oldfunc = ifunc.varname()
    vn_data = idata.varname()
    retobj = IFunc()
    vn_newfunc = retobj.varname()
    mintface.eval('[p, c, m, o_%s] = fits(%s, copyobj(%s));' % (vn_newfunc, vn_data, vn_oldfunc))
    mintface.eval('%s = o_%s.model;' % (vn_newfunc, vn_newfunc))
    mintface.eval('clear o_%s;' % vn_newfunc)
    return retobj
