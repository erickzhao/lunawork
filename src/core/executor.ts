import {
  ButtonInteraction,
  CommandInteraction,
  CommandInteractionOption,
  ContextMenuInteraction,
  Message,
  SelectMenuInteraction,
} from 'discord.js'
import { LunaworkClient } from '../core/client'
import { Stage } from '../core/stage'
import { listener } from '../decorators/listener'
import { isMessage } from '../lib/type-guarding'
import { getArgTypes } from '../lib/arg-type-provider'
import { Inhibitor } from '../lib/inhibitors'
import { Context } from '../lib/context'
import { IButton } from '../lib/types/button'
import { IPrefixCommand } from '../lib/types/prefix'
import { IApplicationCommand } from '../lib/types/application-command'
import { ISelectMenu } from '../lib/types/select-menu'

let deprecatedTriggered = false

export class ExecutorStage extends Stage {
  public constructor(client: LunaworkClient) {
    super(client)
  }

  //#region Default command with prefix
  @listener({ event: 'messageCreate' })
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
    const cmd = this.client.manager.getPrefixedCommandByTrigger(cmdTrigger)
    if (!cmd) {
      return
    }

    for (const inhibitor of cmd.inhibitors) {
      const inhibited = await this.inhibiteCommand(inhibitor, msg)
      if (inhibited) {
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
        return msg.channel.send({
          content: `:warning: expected at least ${leastArgs} argument${
            leastArgs !== 1 ? 's' : ''
          } but got ${stringArgs.length} argument${
            stringArgs.length !== 1 ? 's' : ''
          } instead`,
        })
      }

      for (const i in stringArgs) {
        if (!cmd.args[i]) {
          continue
        }
        const sa = stringArgs[i]
        const arg = getArgTypes(this.client)[cmd.args[i].type.name](sa, msg)

        if (arg === null || arg === undefined) {
          return msg.channel.send({
            content: `:warning: argument #${
              parseInt(i, 10) + 1
            } is not of expected type ${cmd.args[i].type.name}`,
          })
        } else {
          typedArgs.push(arg)
        }
      }
    }

    // Execute the command
    return await this.execute({
      msg,
      cmd,
      typedArgs,
      cmdTrigger,
      parsed,
    })
  }
  //#endregion

  //#region Application Commands
  @listener({ event: 'interactionCreate' })
  public async onApplicationCommand(interaction: CommandInteraction) {
    if (!interaction.isCommand()) {
      return
    }

    const cmd = this.client.manager.getSlashByTrigger(interaction.commandName)

    if (!cmd) {
      return
    }

    for (const inhibitor of cmd.inhibitors) {
      const inhibited = await this.inhibiteCommand(inhibitor, interaction)
      if (inhibited) {
        return
      }
    }

    let resultArgs: Record<string, unknown> = {}

    for (const option of interaction.options.data) {
      if (
        option.type === 'SUB_COMMAND_GROUP' ||
        option.type === 'SUB_COMMAND'
      ) {
        const args = this.handleSubCommand(interaction.options.data)
        resultArgs = args
      } else {
        resultArgs[option.name] =
          option.member || option.user || option.channel || option.value
      }
    }

    return this.execute({
      msg: interaction,
      cmd,
      objectArgs: resultArgs,
    })
  }

  private handleSubCommand(
    options: ReadonlyArray<CommandInteractionOption>,
    baseObject?: Record<string, unknown>,
  ): Record<string, unknown> {
    const output = baseObject ?? ({} as Record<string, unknown>)

    options.forEach((option) => {
      if (!option.value && !option.options && option.name) {
        const type = this.getCorrectType(option.type)
        output[type] = option.name
      }

      if (option.value) {
        output[option.name] =
          option.member || option.user || option.channel || option.value
      }

      if (option.options && option.name) {
        const type = this.getCorrectType(option.type)
        output[type] = option.name
        this.handleSubCommand(option.options, output)
      }
    })

    return output
  }

  private getCorrectType(type: CommandInteractionOption['type']): string {
    if (type === 'SUB_COMMAND') {
      return 'subCommand'
    } else if (type === 'SUB_COMMAND_GROUP') {
      return 'subCommandGroup'
    }

    return ''
  }

  @listener({ event: 'interactionCreate' })
  public async onContextMenu(interaction: ContextMenuInteraction) {
    if (!interaction.isContextMenu()) {
      return
    }

    const cmd = this.client.manager.getSlashByName(interaction.commandName)

    if (!cmd) {
      return
    }

    for (const inhibitor of cmd.inhibitors) {
      const inhibited = await this.inhibiteCommand(inhibitor, interaction)
      if (inhibited) {
        return
      }
    }

    return this.execute({
      msg: interaction,
      cmd,
    })
  }
  //#endregion

  //#region Buttons
  @listener({ event: 'interactionCreate' })
  public async onButton(interaction: ButtonInteraction) {
    if (!interaction.isButton()) {
      return
    }

    const cmd = Array.from(this.client.manager.buttons).find(
      (b) => b.customID === interaction.customId,
    )

    if (!cmd) {
      return
    }

    for (const inhibitor of cmd.inhibitors) {
      const inhibited = await this.inhibiteCommand(inhibitor, interaction)
      if (inhibited) {
        return
      }
    }

    return this.execute({
      cmd,
      msg: interaction,
    })
  }
  //#endregion

  //#region Select Menus
  @listener({ event: 'interactionCreate' })
  public async onSelectMenu(interaction: SelectMenuInteraction) {
    if (!interaction.isSelectMenu()) {
      return
    }

    const cmd = Array.from(this.client.manager.selectMenus).find(
      (b) => b.customID === interaction.customId,
    )

    if (!cmd) {
      return
    }

    for (const inhibitor of cmd.inhibitors) {
      const inhibited = await this.inhibiteCommand(inhibitor, interaction)
      if (inhibited) {
        return
      }
    }

    return this.execute({
      cmd,
      msg: interaction,
    })
  }
  //#endregion

  private async execute({
    cmd,
    msg,
    typedArgs = [],
    objectArgs = {},
    cmdTrigger,
    parsed,
  }: {
    msg:
      | Message
      | ButtonInteraction
      | CommandInteraction
      | ContextMenuInteraction
      | SelectMenuInteraction
    cmd: IPrefixCommand | IButton | ISelectMenu | IApplicationCommand
    objectArgs?: Record<string, unknown>
    typedArgs?: Array<unknown>
    parsed?: string
    cmdTrigger?: string
  }) {
    const context =
      msg instanceof Message && 'usesContextAPI' in cmd
        ? new Context(msg, parsed!, cmdTrigger!, cmd)
        : undefined

    try {
      const messageWithContext =
        msg instanceof Message && 'usesContextAPI' in cmd && cmd.usesContextAPI
          ? context
          : msg

      let result
      if (objectArgs) {
        // @ts-expect-error
        result = cmd.func.call(
          cmd.stage,
          messageWithContext,
          Object.freeze(objectArgs),
        )
      } else {
        // @ts-expect-error
        result = cmd.func.call(cmd.stage, messageWithContext, ...typedArgs)
      }

      if (result instanceof Promise) {
        await result
      }
    } catch (err) {
      if (msg instanceof Message) {
        console.error(
          `error while executing command ${cmd.id}! executed by ${msg.author.tag}/${msg.author.id} in guild ${msg.guild?.name}/${msg.guild?.id}\n`,
          err,
        )
        // @ts-expect-error
        cmd.onError(msg, err)
      } else {
        console.error(
          `error while exeucting command ${cmd.id}! executed by ${msg.user.tag}/${msg.user.id} in guild ${msg.guild?.name}/${msg.guild?.id}\n`,
          err,
        )
      }
      // @ts-expect-error
      cmd.onError(msg, err)
    }

    return
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

  private async inhibiteCommand(
    inhibitor: Inhibitor,
    interaction:
      | Message
      | CommandInteraction
      | ContextMenuInteraction
      | ButtonInteraction
      | SelectMenuInteraction,
  ): Promise<boolean> {
    const reason = await inhibitor(interaction, this.client)

    if (!reason) {
      return false
    }

    if (typeof reason === 'string') {
      if (!deprecatedTriggered) {
        console.log(
          '[@siberianmh/lunawork] The string inhibitors is deprecated, switch to use object',
        )
        deprecatedTriggered = true
      }

      if (isMessage(interaction)) {
        await interaction.channel.send({
          content: reason,
        })
      } else {
        await interaction.reply({
          content: reason,
        })
      }
      return true
    } else if ('content' in reason) {
      if (isMessage(interaction)) {
        await interaction.channel.send({
          content: reason.content ?? undefined,
          embeds: reason.embeds ?? undefined,
          components: reason.components ?? undefined,
        })
      } else {
        await interaction.reply({
          content: reason.content ?? undefined,
          embeds: reason.embeds ?? undefined,
          components: reason.components ?? undefined,
          ephemeral: true,
        })
      }
    }

    return false
  }
}
