import type { Command } from '../../commands.js'

const node = {
  type: 'local-jsx',
  name: 'node',
  aliases: ['agent-node', 'gateway'],
  description: 'Expose CyberCode models and routes to other agents',
  argumentHint: '[status|start|stop|key|rotate|revoke|limit|allow|default]',
  load: () => import('./node.js'),
} satisfies Command

export default node
