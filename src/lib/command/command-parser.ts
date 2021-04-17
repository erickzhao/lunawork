import { LunaworkClient } from '../lunawork-client'
import { Message } from 'discord.js'
import { getArgTypes } from '../utils/arg-type-provider'
import { Context } from '../utils/context'
import { listener } from '../listener/decorator'
import { Stage } from '../stage'
import { CommandInteraction } from '../../djs-extend/command-interaction'

export class CommandParserStage extends Stage {
  public constructor(client: LunaworkClient) {
    super(client)
  }

  // Default command with prefix
  @listener({ event: 'message' })
  public async onMessage(msg: Message) {
    if (msg.author && msg.author.bot) {
      return
    }

    const prefixes = await this.client.fetchPrefix(msg)
    const parsed = this.getPrefix(msg.content, prefixes)

    if (!parsed) {
      return
    }

    const noPrefix = msg.content.replace(parsed, '')
    const stringArgs: Array<string> = noPrefix.split(' ').slice(1) || []
    const cmdTrigger = noPrefix.split(' ')[0].toLowerCase()
    const cmd = this.client.commandManager.getByTrigger(cmdTrigger)
    if (!cmd) {
      return
    }

    for (const inhibitor of cmd.inhibitors) {
      const reason = await inhibitor(msg, this.client)
      if (reason) {
        msg.reply(`:warning: command was inhibited: ${reason}`)
        return
      }
    }

    // Argument type validation
    const typedArgs = [] as Array<unknown>
    const leastArgs =
      cmd.args.length - cmd.args.filter((x) => x.optional).length
    if (cmd.single) {
      typedArgs.push(stringArgs.join(' '))
    } else {
      if (stringArgs.length < leastArgs) {
        return msg.reply(
          `:warning: expected atleast ${leastArgs} argument${
            leastArgs !== 1 ? 's' : ''
          } but got ${stringArgs.length} argument${
            stringArgs.length !== 1 ? 's' : ''
          } instead`,
        )
      }
      for (const i in stringArgs) {
        if (!cmd.args[i]) {
          continue
        }
        const sa = stringArgs[i]
        const arg = getArgTypes(this.client)[cmd.args[i].type.name](sa, msg)
        if (arg === null || arg === undefined) {
          return msg.reply(
            `:warning: argument #${
              parseInt(i, 10) + 1
            } is not of expected type ${cmd.args[i].type.name}`,
          )
        } else {
          typedArgs.push(arg)
        }
      }
    }

    // Executing the command
    const context = new Context(msg, parsed, cmdTrigger, cmd)
    try {
      const result = cmd.func.call(
        cmd.module,
        cmd.usesContextAPI ? context : msg,
        ...typedArgs,
      )
      if (result instanceof Promise) {
        await result
      }
    } catch (err) {
      console.error(
        `error while executing command ${cmd.id}! executed by ${msg.author.tag}/${msg.author.id} in guild ${msg.guild?.name}/${msg.guild?.id}\n`,
        err,
      )
      cmd.onError(msg, err)
    }
    return this.client.emit('comamndExecution', context)
  }

  // Slash Commands
  @listener({ event: 'interaction' })
  public async onInteraction(interaction: CommandInteraction) {
    if (!interaction.isCommand()) {
      return
    }

    // const cmd = this.client.commandManager.getByTrigger(interaction.commandName)

    // // It's not possible in case of slash commands
    // if (!cmd) {
    //   return
    // }

    console.log(interaction.commandName)
    return interaction.reply(interaction.commandName)
  }

  private getPrefix(
    content: string,
    prefixes: Array<string> | string | null,
  ): string | null {
    if (prefixes === null) {
      return null
    }

    if (typeof prefixes === 'string') {
      return content.startsWith(prefixes.toLowerCase()) ? prefixes : null
    }

    return (
      prefixes.find((prefix) => content.startsWith(prefix.toLowerCase())) ??
      null
    )
  }
}
