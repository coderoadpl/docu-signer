import path from 'node:path';

const COLOR = new Set([
  'color',
  'caretColor',
  'fill',
  'stroke',
  'textDecorationColor',
  'columnRuleColor',
]);

const TYPOGRAPHY = new Set([
  'font',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'fontFeatureSettings',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'textDecoration',
  'textDecorationLine',
  'textDecorationStyle',
  'textIndent',
  'textShadow',
  'wordSpacing',
  'wordBreak',
  'whiteSpace',
  'textOverflow',
]);

const classify = (key) => {
  if (key === 'bgcolor' || key.startsWith('background')) return 'background';
  if (key.startsWith('border') || key.startsWith('outline') || key === 'boxShadow') {
    return 'border-styling';
  }
  if (COLOR.has(key)) return 'color';
  if (TYPOGRAPHY.has(key)) return 'typography';
  return null;
};

const keyName = (key) => {
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal') return String(key.value);
  return null;
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'sx props may only carry layout/spacing/flex/grid/position/sizing keys; color, typography, background and border-styling keys are reserved for theme.ts. A frozen baseline tolerates existing debt and may only shrink.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          baseline: { type: 'object', additionalProperties: { type: 'number' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      reserved:
        'sx `{{name}}` is a {{category}} key reserved for theme.ts; sx may only carry layout/spacing/flex/grid/position/sizing keys.',
      staleBaseline:
        'sx-layout-only baseline for {{key}} is {{allowed}} but only {{actual}} reserved key(s) remain; lower the baseline (it may only shrink).',
    },
  },
  create(context) {
    const baseline = context.options[0]?.baseline ?? {};
    const relativeKey = path.relative(context.cwd, context.filename).split(path.sep).join('/');
    const allowed = baseline[relativeKey] ?? 0;
    const reserved = [];
    let sxDepth = 0;

    return {
      'JSXAttribute[name.name="sx"]'() {
        sxDepth += 1;
      },
      'JSXAttribute[name.name="sx"]:exit'() {
        sxDepth -= 1;
      },
      Property(node) {
        if (sxDepth === 0 || node.computed) return;
        const name = keyName(node.key);
        if (!name) return;
        const category = classify(name);
        if (category) reserved.push({ node, name, category });
      },
      'Program:exit'(programNode) {
        if (allowed > reserved.length) {
          context.report({
            node: programNode,
            messageId: 'staleBaseline',
            data: { key: relativeKey, allowed, actual: reserved.length },
          });
          return;
        }
        const excess = reserved.length - allowed;
        if (excess === 0) return;
        const sorted = [...reserved].sort((a, b) => a.node.range[0] - b.node.range[0]);
        for (const item of sorted.slice(sorted.length - excess)) {
          context.report({
            node: item.node,
            messageId: 'reserved',
            data: { name: item.name, category: item.category },
          });
        }
      },
    };
  },
};
