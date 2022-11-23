import { EMPTY_OBJ, hooks, isArray, isFunction, isObject, isString, isUndefined, Shortcuts, toCamelCase, warn } from '@ice/shared';

import {
  CATCH_VIEW,
  CATCHMOVE,
  CLASS,
  FOCUS,
  ID,
  PROPERTY_THRESHOLD,
  PURE_VIEW,
  STATIC_VIEW,
  STYLE,
  VIEW,
} from '../constants/index.js';
import { MutationObserver, MutationRecordType } from '../dom-external/mutation-observer/index.js';
import type { Attributes, Func } from '../interface/index.js';
import { extend, getComponentsAlias, isElement, isHasExtractProp, shortcutAttr } from '../utils/index.js';
import { ClassList } from './class-list.js';
import type { Event } from './event.js';
import { eventSource } from './event-source.js';
import { Node } from './node.js';
import { NodeType } from './node_types.js';
import { Style } from './style.js';
import { treeToArray } from './tree.js';

export class Element extends Node {
  public tagName: string;
  public props: Record<string, any> = {};
  public style: Style;
  public dataset: Record<string, unknown> = EMPTY_OBJ;
  public innerHTML: string;

  public constructor() {
    super();
    this.nodeType = NodeType.ELEMENT_NODE;
    this.style = new Style(this);
    hooks.call('patchElement', this);
  }

  private _stopPropagation(event: Event) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let target = this;
    // eslint-disable-next-line no-cond-assign
    while ((target = target.parentNode as this)) {
      const listeners = target.__handlers[event.type];

      if (!isArray(listeners)) {
        continue;
      }

      for (let i = listeners.length; i--;) {
        const l = listeners[i];
        l._stop = true;
      }
    }
  }

  public get id(): string {
    return this.getAttribute(ID)!;
  }

  public set id(val: string) {
    this.setAttribute(ID, val);
  }

  public get className(): string {
    return this.getAttribute(CLASS) || '';
  }

  public set className(val: string) {
    this.setAttribute(CLASS, val);
  }

  public get cssText(): string {
    return this.getAttribute(STYLE) || '';
  }

  public get classList(): ClassList {
    return new ClassList(this.className, this);
  }

  public get children(): Element[] {
    return this.childNodes.filter(isElement);
  }

  public get attributes(): Attributes[] {
    const { props } = this;
    const propKeys = Object.keys(props);
    const style = this.style.cssText;
    const attrs = propKeys.map(key => ({ name: key, value: props[key] }));
    return attrs.concat(style ? { name: STYLE, value: style } : []);
  }

  public get textContent(): string {
    let text = '';
    const { childNodes } = this;

    for (let i = 0; i < childNodes.length; i++) {
      text += childNodes[i].textContent;
    }

    return text;
  }

  public set textContent(text: string) {
    super.textContent = text;
  }

  public hasAttribute(qualifiedName: string): boolean {
    return !isUndefined(this.props[qualifiedName]);
  }

  public hasAttributes(): boolean {
    return this.attributes.length > 0;
  }

  public get focus() {
    return function () {
      this.setAttribute(FOCUS, true);
    };
  }

  // 兼容 Vue3，详情请见：https://github.com/NervJS/taro/issues/10579
  public set focus(value) {
    this.setAttribute(FOCUS, value);
  }

  public blur() {
    this.setAttribute(FOCUS, false);
  }

  public setAttribute(qualifiedName: string, value: any): void {
    process.env.NODE_ENV !== 'production' && warn(
      isString(value) && value.length > PROPERTY_THRESHOLD,
      `元素 ${this.nodeName} 的 ${qualifiedName} 属性值数据量过大，可能会影响渲染性能。考虑在 CSS 中使用 base64。`,
    );

    const isPureView = this.nodeName === VIEW && !isHasExtractProp(this) && !this.isAnyEventBinded();

    if (qualifiedName !== STYLE) {
      MutationObserver.record({
        target: this,
        type: MutationRecordType.ATTRIBUTES,
        attributeName: qualifiedName,
        oldValue: this.getAttribute(qualifiedName),
      });
    }

    switch (qualifiedName) {
      case STYLE:
        this.style.cssText = value as string;
        break;
      case ID:
        if (this.uid !== this.sid) {
          // eventSource[sid] 永远保留，直到组件卸载
          // eventSource[uid] 可变
          eventSource.delete(this.uid);
        }
        value = String(value);
        this.props[qualifiedName] = this.uid = value;
        eventSource.set(value, this);
        break;
      default:
        this.props[qualifiedName] = value as string;

        if (qualifiedName.startsWith('data-')) {
          if (this.dataset === EMPTY_OBJ) {
            this.dataset = Object.create(null);
          }
          this.dataset[toCamelCase(qualifiedName.replace(/^data-/, ''))] = value;
        }
        break;
    }

    // Serialization
    if (!this._root) return;

    const componentsAlias = getComponentsAlias();
    const _alias = componentsAlias[this.nodeName];
    const viewAlias = componentsAlias[VIEW]._num;
    const staticViewAlias = componentsAlias[STATIC_VIEW]._num;
    const catchViewAlias = componentsAlias[CATCH_VIEW]._num;
    const { _path } = this;

    qualifiedName = shortcutAttr(qualifiedName);

    const payload = {
      path: `${_path}.${toCamelCase(qualifiedName)}`,
      value: isFunction(value) ? () => value : value,
    };

    hooks.call('modifySetAttrPayload', this, qualifiedName, payload, componentsAlias);

    if (_alias) {
      const qualifiedNameAlias = _alias[qualifiedName] || qualifiedName;
      payload.path = `${_path}.${toCamelCase(qualifiedNameAlias)}`;
    }

    this.enqueueUpdate(payload);

    if (this.nodeName === VIEW) {
      if (toCamelCase(qualifiedName) === CATCHMOVE) {
        // catchMove = true: catch-view
        // catchMove = false: view or static-view
        this.enqueueUpdate({
          path: `${_path}.${Shortcuts.NodeName}`,
          value: value ? catchViewAlias : (
            this.isAnyEventBinded() ? viewAlias : staticViewAlias
          ),
        });
      } else if (isPureView && isHasExtractProp(this)) {
        // pure-view => static-view
        this.enqueueUpdate({
          path: `${_path}.${Shortcuts.NodeName}`,
          value: staticViewAlias,
        });
      }
    }
  }

  public removeAttribute(qualifiedName: string) {
    const isStaticView = this.nodeName === VIEW && isHasExtractProp(this) && !this.isAnyEventBinded();

    MutationObserver.record({
      target: this,
      type: MutationRecordType.ATTRIBUTES,
      attributeName: qualifiedName,
      oldValue: this.getAttribute(qualifiedName),
    });

    if (qualifiedName === STYLE) {
      this.style.cssText = '';
    } else {
      const isInterrupt = hooks.call('onRemoveAttribute', this, qualifiedName);
      if (isInterrupt) {
        return;
      }

      if (!Object.prototype.hasOwnProperty.call(this.props, qualifiedName)) {
        return;
      }
      delete this.props[qualifiedName];
    }

    // Serialization
    if (!this._root) return;

    const componentsAlias = getComponentsAlias();
    const _alias = componentsAlias[this.nodeName];
    const viewAlias = componentsAlias[VIEW]._num;
    const staticViewAlias = componentsAlias[STATIC_VIEW]._num;
    const pureViewAlias = componentsAlias[PURE_VIEW]._num;
    const { _path } = this;

    qualifiedName = shortcutAttr(qualifiedName);

    const payload = {
      path: `${_path}.${toCamelCase(qualifiedName)}`,
      value: '',
    };

    hooks.call('modifyRmAttrPayload', this, qualifiedName, payload, componentsAlias);

    if (_alias) {
      const qualifiedNameAlias = _alias[qualifiedName] || qualifiedName;
      payload.path = `${_path}.${toCamelCase(qualifiedNameAlias)}`;
    }

    this.enqueueUpdate(payload);

    if (this.nodeName === VIEW) {
      if (toCamelCase(qualifiedName) === CATCHMOVE) {
        // catch-view => view or static-view or pure-view
        this.enqueueUpdate({
          path: `${_path}.${Shortcuts.NodeName}`,
          value: this.isAnyEventBinded() ? viewAlias : (isHasExtractProp(this) ? staticViewAlias : pureViewAlias),
        });
      } else if (isStaticView && !isHasExtractProp(this)) {
        // static-view => pure-view
        this.enqueueUpdate({
          path: `${_path}.${Shortcuts.NodeName}`,
          value: pureViewAlias,
        });
      }
    }
  }

  public getAttribute(qualifiedName: string): string {
    const attr = qualifiedName === STYLE ? this.style.cssText : this.props[qualifiedName];
    return attr ?? '';
  }

  public getElementsByTagName(tagName: string): Element[] {
    return treeToArray(this, (el) => {
      return el.nodeName === tagName || (tagName === '*' && this !== el);
    });
  }

  public getElementsByClassName(className: string): Element[] {
    return treeToArray(this, (el) => {
      const { classList } = el;
      const classNames = className.trim().split(/\s+/);
      return classNames.every(c => classList.has(c));
    });
  }

  public dispatchEvent(event: Event): boolean {
    const { cancelable } = event;

    const listeners = this.__handlers[event.type];

    if (!isArray(listeners)) {
      return false;
    }

    for (let i = listeners.length; i--;) {
      const listener = listeners[i];
      let result: unknown;
      if (listener._stop) {
        listener._stop = false;
      } else {
        hooks.call('modifyDispatchEvent', event, this);
        result = listener.call(this, event);
      }
      if ((result === false || event._end) && cancelable) {
        event.defaultPrevented = true;
      }

      if (event._end && event._stop) {
        break;
      }
    }

    if (event._stop) {
      this._stopPropagation(event);
    } else {
      event._stop = true;
    }

    return listeners != null;
  }

  public addEventListener(type, handler, options) {
    const name = this.nodeName;
    const SPECIAL_NODES = hooks.call('getSpecialNodes')!;

    let sideEffect = true;
    if (isObject<Record<string, any>>(options) && options.sideEffect === false) {
      sideEffect = false;
      delete options.sideEffect;
    }

    if (sideEffect !== false && !this.isAnyEventBinded() && SPECIAL_NODES.indexOf(name) > -1) {
      const componentsAlias = getComponentsAlias();
      const alias = componentsAlias[name]._num;
      this.enqueueUpdate({
        path: `${this._path}.${Shortcuts.NodeName}`,
        value: alias,
      });
    }

    super.addEventListener(type, handler, options);
  }

  public removeEventListener(type, handler, sideEffect = true) {
    super.removeEventListener(type, handler);

    const name = this.nodeName;
    const SPECIAL_NODES = hooks.call('getSpecialNodes')!;

    if (sideEffect !== false && !this.isAnyEventBinded() && SPECIAL_NODES.indexOf(name) > -1) {
      const componentsAlias = getComponentsAlias();
      const value = isHasExtractProp(this) ? `static-${name}` : `pure-${name}`;
      const valueAlias = componentsAlias[value]._num;
      this.enqueueUpdate({
        path: `${this._path}.${Shortcuts.NodeName}`,
        value: valueAlias,
      });
    }
  }

  static extend(methodName: string, options: Func | Record<string, any>) {
    extend(Element, methodName, options);
  }
}
