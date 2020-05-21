import collections


class Delegate:
    def __init__(self, name):
        self.name = name

    def __get__(self, instance, owner):
        return getattr(instance, self.name)


class ArrayCache(list):
    # implicitly called magic methods don't invoke __getattribute__
    # https://docs.python.org/3/reference/datamodel.html#special-method-lookup
    # all method lookups obey the descriptor protocol
    # this is how the implicit api is defined in ccxt under the hood
    __iter__ = Delegate('__iter__')
    __getitem__ = Delegate('__getitem__')
    __setitem__ = Delegate('__setitem__')

    def __init__(self, max_size):
        super(list, self).__init__()
        self._deque = collections.deque([], max_size)

    def __eq__(self, other):
        return list(self) == other

    def __getattribute__(self, item):
        deque = super(list, self).__getattribute__('_deque')
        return getattr(deque, item)

    def __repr__(self):
        return str(list(self))
