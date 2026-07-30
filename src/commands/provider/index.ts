import type { Command } from '../../commands.js'

const provider = {
  type: 'local-jsx',
  name: 'provider',
  aliases: ['providers'],
  description: 'Configure or switch model providers',
  argumentHint: '[status|sync [provider]|auto-sync on|off [provider]]',
  load: () => import('./provider.js'),
} satisfies Command

export default provider
