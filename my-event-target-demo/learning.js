

const myEventObject = {
    name: 'myDivTarget',
    parent: null,
    children: [],
    _listeners: [
        {
            type: 'click',
            callback: () => {
                console.log('click');
            },
            capture: false,
            once: false,
            passive: false,
            signal: null,
            removed: false
        }
    ],
    addEventListener(type, callback, options = {}) {
        this._listeners.push({
            type,
            callback,
            options
        });
    },
    removeEventListener(type, callback, options = {}) {
        this._listeners = this._listeners.filter(listener => listener.type !== type || listener.callback !== callback || listener.options !== options);
    },
    dispatchEvent(event) {
        if (event._dispatchFlag) {
            throw new Error('This event is already being dispatched');
        }
        event._dispatchFlag = true;
        event.target = this;
        event.currentTarget = this;
        this._listeners.forEach(listener => {
            if (listener.type === event.type && listener.callback === event.callback && listener.options === event.options) {
                listener.callback.call(this, event);
            }
        });
        
        // 如果能冒泡
        if (event.bubbles) {
            this.parent.dispatchEvent(event);
        }
    }
}