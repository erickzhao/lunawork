import { Stage } from '../stage'
import { WSEvent } from '../types/events'
import { websocketMetas } from '../utils/reflect-prefixes'

export interface IWebsocketDecoratorOptions {
  event: WSEvent
}

export interface IWebsocketDecoratorMeta {
  readonly event: WSEvent
  readonly id: string
  readonly func: (...args: Array<any>) => void
}

export function wsListener(opts: IWebsocketDecoratorOptions) {
  return function (
    target: Stage,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const targetConstructorName = target.constructor.name

    if (!(target instanceof Stage)) {
      throw new TypeError(`${targetConstructorName} doesn't extend Stage`)
    }

    if (!(descriptor.value.constructor instanceof Function)) {
      throw new TypeError(
        `Decorator needs to be applied to a Method. (${target.constructor.name}#${descriptor.value.name} was ${descriptor.value.constructor.name})`,
      )
    }

    const websocketsMeta: Array<IWebsocketDecoratorMeta> =
      Reflect.getMetadata(websocketMetas, target) || []

    websocketsMeta.push({
      event: opts.event,
      id: propertyKey,
      func: Reflect.get(target, propertyKey),
    })

    Reflect.defineMetadata(websocketMetas, websocketsMeta, target)
  }
}
