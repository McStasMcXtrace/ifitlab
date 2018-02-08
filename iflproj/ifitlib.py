'''
iFit-interfaced library used as a base for generating ifitlab node types.

Notes on node type generation:
1) any class, function or method can be is flagged as "non-public" by an underscore prefix in 
its name - e.g. _get_plot_1D - will be omitted.
2) any class can implement the static ObjReprJson.non_polymorphic_typename (annotated by @staticmethod)
whereby its constructor node will output that type name

Notes on class features:
1) inherit all classes from ObjReprJson
2) implement get_repr and set_user_data to interact with low-level data. Extend or use _get_full_repr_dict only.
3) implement non_polymorphic_typename (annotated with @staticmethod) if you want to overload 
the node type of the resulting constructor node
'''
__author__ = "Jakob Garde"

import engintf
import scipy.misc
import io
import base64
import matlab.engine
import logging
logging.basicConfig(level=logging.DEBUG)
import numpy as np

_eng = None
def _get_interface():
    global _eng
    if not _eng:
        _eng = matlab.engine.start_matlab('-nodesktop -nosplash', async=False)
        _eng.eval("addpath(genpath('/home/jaga/source/REPO_ifit'))")
    return _eng

class _IFitObject(engintf.ObjReprJson):
    ''' implements a way to pass on the varnames between instances '''
    def _varname(self):
        return 'obj_%d' % id(self)

class IData(_IFitObject):
    def __init__(self, url: str):
        logging.debug("IData.__init__('%s')" % url)
        self.eng = _get_interface()
        self.url = url
        varname = self._varname()
        if url==None:
            '''
            NOTE: This branch (url==None) is to be used only programatically, as a "prepper" intermediary
            state to get a varname from python, before assigning an actual ifit object, for example while
            executing (the python-side bookkeeping of) functions like fits or eval.
            '''
            pass
        else:
            self.eng.eval("%s = iData('%s')" % (varname, url), nargout=0)
            #self.eng.assign("%s" % vn, "iData('%s')" % url)
            #self.eng.eval("%s = %s" % (varname, expression), nargout=0)

    def _get_plot_1D(self, axisvals, signal, yerr, xlabel, ylabel, title):
        ''' returns the dict required by the svg 1d plotting function '''
        params = {}
        p = params
        p['w'] = 326
        p['h'] = 220
        p['x'] = axisvals[0]
        p['y'] = signal
        p['yerr'] = yerr
        p['xlabel'] = xlabel
        p['ylabel'] = ylabel
        p['title'] = title
        p['ndims'] = 1
        return params

    def _get_plot_2D(self, axisvals, signal, yerr, xlabel, ylabel, title):
        ''' returns the dict required by the svg 1d plotting function '''
        def lookup(cm, x):
            xp = (len(cm)-1) * x
            f = np.floor(xp)
            c = np.ceil(xp)
            a1 = xp - f
            a2 = c - xp
            # the below should be better, but there are still some strange artefacts in the generated image
            #return np.add(cm[f], (xp-f)*(np.subtract(cm[c], cm[f])) ).astype(np.ubyte)
            return cm[np.int(np.round(xp))]

        def get_cm():
            return np.array([[  0,   0, 143, 255], [  0,   0, 159, 255], [  0,   0, 175, 255], [  0,   0, 191, 255], [  0,   0, 207, 255], [  0,   0, 223, 255], [  0,   0, 239, 255], [  0,   0, 255, 255], [  0,  16, 255, 255], [  0,  32, 255, 255], [  0,  48, 255, 255], [  0,  64, 255, 255], [  0,  80, 255, 255], [  0,  96, 255, 255], [  0, 112, 255, 255], [  0, 128, 255, 255], [  0, 143, 255, 255], [  0, 159, 255, 255], [  0, 175, 255, 255], [  0, 191, 255, 255], [  0, 207, 255, 255], [  0, 223, 255, 255], [  0, 239, 255, 255], [  0, 255, 255, 255], [ 16, 255, 239, 255], [ 32, 255, 223, 255], [ 48, 255, 207, 255], [ 64, 255, 191, 255], [ 80, 255, 175, 255], [ 96, 255, 159, 255], [112, 255, 143, 255], [128, 255, 128, 255], [143, 255, 112, 255], [159, 255,  96, 255], [175, 255,  80, 255], [191, 255,  64, 255], [207, 255,  48, 255], [223, 255,  32, 255], [239, 255,  16, 255], [255, 255,   0, 255], [255, 239,   0, 255], [255, 223,   0, 255], [255, 207,   0, 255], [255, 191,   0, 255], [255, 175,   0, 255], [255, 159,   0, 255], [255, 143,   0, 255], [255, 128,   0, 255], [255, 112,   0, 255], [255,  96,   0, 255], [255,  80,   0, 255], [255,  64,   0, 255], [255,  48,   0, 255], [255,  32,   0, 255], [255,  16,   0, 255], [255,   0,   0, 255], [239,   0,   0, 255], [223,   0,   0, 255], [207,   0,   0, 255], [191,   0,   0, 255], [175,   0,   0, 255], [159,   0,   0, 255], [143,   0,   0, 255], [128,   0,   0, 255]], dtype=np.ubyte)
        
        dims = np.shape(signal)
        
        # create the 2d data as a png given our colormap
        img = np.zeros((dims[0], dims[1], 4))
        maxval = np.max(signal)
        cm = get_cm()
        for i in range(dims[0]):
            for j in range(dims[1]):
                color = lookup(cm, signal[i][j]/maxval)
                img[i,j,:] = color
            
        # encode png as base64 string
        image = scipy.misc.toimage(img)
        output = io.BytesIO()
        image.save(output, format="png")
        contents = output.getvalue()
        output.close()
        encoded_2d_data = str(base64.b64encode(contents)).lstrip('b').strip("\'")
            
        # color bar
        img = np.zeros((256, 1, 4))
        for i in range(256):
            color = lookup(cm, i/255)
            img[255-i, 0] = color
        cb_img = scipy.misc.toimage(img)
        output = io.BytesIO()
        cb_img.save(output, format='png')
        contents = output.getvalue()
        output.close()
        encoded_cb = str(base64.b64encode(contents)).lstrip('b').strip("\'")

        x = axisvals[0]
        y = axisvals[1]
        xmin = np.min(x)
        xmax = np.max(x)
        ymin = np.min(y)
        ymax = np.max(y)
            
        cb_min = np.min(signal)
        cb_max = np.max(signal)

        params = {}
        p = params
        p['w'] = 326
        p['h'] = 220

        p['xmin'] = xmin
        p['xmax'] = xmax
        p['ymin'] = ymin
        p['ymax'] = ymax

        p['img2dData'] = encoded_2d_data
        p['imgColorbar'] = encoded_cb

        p['cbMin'] = cb_min
        p['cbMax'] = cb_max

        p['xlabel'] = xlabel
        p['ylabel'] = ylabel
        p['title'] = title
        
        p['ndims'] = 2

        return params

    def get_repr(self):
        retdct = self._get_full_repr_dict()
        try:
            varname = self._varname()
            ndims = self.eng.eval('ndims(%s)' % varname)
            ndims = int(ndims)
            
            signal = None
            error = None
            axes_names = self.eng.eval('%s.Axes' % varname, nargout=1) # NOTE: len(axes_names) == ndims
            axesvals = []
            pltdct = {}
            
            if not ndims == len(axes_names):
                # TODO: handle this case seperately, in which ifit has not found any axes in the data
                raise Exception("ifit could not find axes")
    
            # get signal
            if ndims == 1:
                #xvals = np.array(self.eng.eval('%s.%s' % (varname, axes_names[0]) )[0]).astype(np.float)
                xvals = list(self.eng.eval('%s.%s' % (varname, axes_names[0]) )[0])
                axesvals.append(xvals)
                
                signal = np.array(self.eng.eval('%s.Signal' % varname, nargout=1)).astype(np.float)
                signal = np.reshape(signal, (1, len(signal)))[0].tolist()
                error = np.array(self.eng.eval('%s.Error' % varname, nargout=1)).astype(np.float)
                error = np.reshape(error, (1, len(error)))[0].tolist()
                
                # TODO: what about monitor?
                #monitor = np.array(self.eng.eval('%s.Monitor' % _varname, nargout=1))
                #monitor = np.reshape(monitor, (1, len(monitor)))[0]
                #monitor = None
                
                pltdct = self._get_plot_1D(axesvals, signal, error, xlabel='x', ylabel='y', title=self._varname())
            elif ndims == 2:
                xvals = list(self.eng.eval('%s.%s' % (varname, axes_names[0]) )[0])
                yvals = list(self.eng.eval('%s.%s' % (varname, axes_names[1]) )[0])
                axesvals.append(xvals)
                axesvals.append(yvals)

                signal = np.array(self.eng.eval('%s.Signal' % varname, nargout=1)).astype(np.float).tolist()
                error = np.array(self.eng.eval('%s.Error' % varname, nargout=1)).astype(np.float).tolist()
                
                pltdct = self._get_plot_2D(axesvals, signal, error, xlabel='monx', ylabel='mony', title=self._varname())
            else:
                for i in range(ndims):
                    ivals = list(self.eng.eval('%s.%s' % (varname, axes_names[i]) )[0])
                    axesvals.append(ivals)
                signal = list(self.eng.eval('%s.Signal' % varname)[0])
                error = list(self.eng.eval('%s.Error' % varname)[0])

            infdct = {}
            infdct['ndims'] = self.eng.eval('ndims(%s)' % varname)

            retdct['plotdata'] = pltdct
            retdct['info'] = infdct

        except Exception as e:
            infdct = {}
            infdct['error'] = 'IData.get_repr failed ("%s")' % str(e)
            retdct['info'] = infdct

        return retdct

    def __exit__(self, exc_type, exc_value, traceback):
        cmd = "clear %s;" % self._varname()
        #logging.debug("running ifit command: %s" % cmd)
        self.eng.eval(cmd)

class IFunc(_IFitObject):
    def _modelsymbol(self):
        return 'iFunc'

    def __init__(self):
        logging.debug("%s.__init__" % str(type(self)))
        
        self.eng = _get_interface()
        vn = self._varname()
        symb = self._modelsymbol()
        self.eng.eval("%s = %s();" % (vn, symb))
        self.eng.eval('tmp=%s([]);' % vn) # this hack makes the symbol '.p' available in ifit on the ifunc object

    def get_repr(self):
        vn = self._varname()

        pkeys = self.eng.get('%s.Parameters' % vn).tolist()

        params = {}
        for key in pkeys:
            idx = pkeys.index(key)
            key0 = key.split(' ')[0]
            self.eng.eval('tmp=%s.%s' % (vn, key0))
            tmp = self.eng.get('tmp')
            print(tmp)
            params[key] = tmp.tolist()

        retdct = self._get_full_repr_dict()
        retdct['userdata'] = params
        return retdct

    def set_user_data(self, json_obj):
        # this would be the 'userdata' branch ...
        vn = self._varname()
        params = self.eng.get('%s.Parameters' % vn).tolist()

        for key in params:
            # some keys contain whitespaces, and can not be used as "struct properties" in matlab
            try:
                val = json_obj[key]
                self.eng.eval('p_%s.%s = %s;' % (vn, key, val))
            except:
                print('IFunc.set_user_data: set failed for param "%s" to val "%s"' % (key, val))
                continue
        self.eng.eval('%s(p_%s);' % (vn, vn))
        self.eng.eval('clear p_%s;' % vn)
        pass

    def __exit__(self, exc_type, exc_value, traceback):
        cmd = "clear %s;" % self._varname()
        #logging.debug("running ifit command: %s" % cmd)
        self.eng.eval(cmd)

class Gauss(IFunc):
    @staticmethod
    def non_polymorphic_typename():
        return 'IFunc'
    def _modelsymbol(self):
        return 'gauss'

class Lorentz(IFunc):
    @staticmethod
    def non_polymorphic_typename():
        return 'IFunc'
    def _modelsymbol(self):
        return 'lorz'

class Lin(IFunc):
    @staticmethod
    def non_polymorphic_typename():
        return 'IFunc'
    def _modelsymbol(self):
        return 'strline'


'''
IFunc operators: Take two or more ifunc objects and combine them into a third. (These are actually functions.)
'''
# TODO: add typehints
def add(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    logging.debug("add: %s, %s" % (ifunc_a, ifunc_b))
    vn1 = ifunc_a._varname()
    vn2 = ifunc_b._varname()
    obj = IFunc()
    vn_new = obj._varname()
    _get_interface().eval('%s = %s + %s;' % (vn_new, vn1, vn2))
    return obj

def subtr(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    logging.debug("subtr: %s, %s" % (ifunc_a, ifunc_b))
    vn1 = ifunc_a._varname()
    vn2 = ifunc_b._varname()
    obj = IFunc()
    vn_new = obj._varname()
    _get_interface().eval('%s = %s - %s;' % (vn_new, vn1, vn2))
    return obj

def mult(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    logging.debug("mult: %s, %s" % (ifunc_a, ifunc_b))
    vn1 = ifunc_a._varname()
    vn2 = ifunc_b._varname()
    obj = IFunc()
    vn_new = obj._varname()
    _get_interface().eval('%s = %s * %s;' % (vn_new, vn1, vn2))
    return obj

def div(ifunc_a: IFunc, ifunc_b: IFunc) -> IFunc:
    logging.debug("div: %s, %s" % (ifunc_a, ifunc_b))
    vn1 = ifunc_a._varname()
    vn2 = ifunc_b._varname()
    obj = IFunc()
    vn_new = obj._varname()
    _get_interface().eval('%s = %s / %s;' % (vn_new, vn1, vn2))
    return obj

def trapz(ifunc: IFunc) -> IFunc:
    logging.debug("trapz: %s" % ifunc)
    vn_old = ifunc._varname()
    obj = IFunc()
    vn_new = obj._varname()
    _get_interface().eval('%s = trapz(%s)' % (vn_new, vn_old))
    return obj

'''
ifit functions
'''
# TODO: add typehints
def eval(idata: IData, ifunc: IFunc) -> IData:
    ''' IData, IFunc -> IData  '''
    logging.debug("eval: %s, %s" % (idata, ifunc))
    vn_olddata = idata._varname()
    vn_func = ifunc._varname()
    retobj = IData(None)
    vn_newdata = retobj._varname()
    # TODO: find a way to clone idata objects
    #mintface.eval('%s = copyobj(%s)(%s);' % (vn_newdata, vn_olddata, vn_func))
    _get_interface().eval('%s = %s(%s);' % (vn_newdata, vn_olddata, vn_func))
    return retobj

def fit(idata: IData, ifunc: IFunc) -> IFunc:
    ''' IData, IFunc -> IFunc '''
    logging.debug("fit: %s, %s" % (idata, ifunc))
    vn_oldfunc = ifunc._varname()
    vn_data = idata._varname()
    retobj = IFunc()
    vn_newfunc = retobj._varname()
    eng = _get_interface()
    eng.eval('[p, c, m, o_%s] = fits(%s, copyobj(%s));' % (vn_newfunc, vn_data, vn_oldfunc))
    eng.eval('%s = o_%s.model;' % (vn_newfunc, vn_newfunc))
    eng.eval('clear o_%s;' % vn_newfunc)
    return retobj

