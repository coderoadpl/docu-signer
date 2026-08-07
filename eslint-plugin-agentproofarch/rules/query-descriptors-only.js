const QUERY_HOOKS = new Set(['useQuery', 'useQueries', 'useMutation']);

const keyName = (key) => {
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal') return String(key.value);
  return null;
};

const rootIdentifier = (node) => {
  switch (node.type) {
    case 'Identifier':
      return node;
    case 'MemberExpression':
      return rootIdentifier(node.object);
    case 'CallExpression':
      return rootIdentifier(node.callee);
    case 'ChainExpression':
      return rootIdentifier(node.expression);
    case 'TSNonNullExpression':
      return rootIdentifier(node.expression);
    default:
      return null;
  }
};

const findVariable = (scope, name) => {
  let current = scope;
  while (current) {
    const found = current.variables.find((variable) => variable.name === name);
    if (found) return found;
    current = current.upper;
  }
  return null;
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'useQuery/useQueries/useMutation arguments must originate from an imported action descriptor, never an inline object literal.',
    },
    schema: [],
    messages: {
      inlineObject:
        'The {{hook}} argument must originate from an imported action descriptor (e.g. actions.todos or actions.todos(...)), never an inline object literal. Spread a descriptor to add callbacks: {{hook}}({ ...actions.foo, onSuccess }).',
      notImported:
        'The {{hook}} argument must originate from an imported action descriptor, not `{{name}}`.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const importedNames = new Set();

    const isFromImport = (node) => {
      const root = rootIdentifier(node);
      if (!root) return false;
      if (importedNames.has(root.name)) return true;
      const variable = findVariable(sourceCode.getScope(root), root.name);
      if (!variable) return false;
      for (const def of variable.defs) {
        if (def.type === 'ImportBinding') return true;
        if (
          def.type === 'Variable' &&
          def.node.type === 'VariableDeclarator' &&
          def.node.init
        ) {
          const initRoot = rootIdentifier(def.node.init);
          if (initRoot && importedNames.has(initRoot.name)) return true;
        }
      }
      return false;
    };

    const checkOrigin = (node, hook) => {
      if (isFromImport(node)) return;
      const root = rootIdentifier(node);
      context.report({
        node,
        messageId: 'notImported',
        data: { hook, name: root ? root.name : 'expression' },
      });
    };

    const validate = (node, hook) => {
      if (node.type === 'SpreadElement') {
        checkOrigin(node.argument, hook);
        return;
      }
      if (node.type === 'ObjectExpression') {
        const spreadsDescriptor = node.properties.some(
          (property) => property.type === 'SpreadElement' && isFromImport(property.argument),
        );
        if (!spreadsDescriptor) {
          context.report({ node, messageId: 'inlineObject', data: { hook } });
        }
        return;
      }
      checkOrigin(node, hook);
    };

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) importedNames.add(specifier.local.name);
      },
      CallExpression(node) {
        if (node.callee.type !== 'Identifier') return;
        const hook = node.callee.name;
        if (!QUERY_HOOKS.has(hook)) return;
        const arg = node.arguments[0];
        if (!arg) return;
        if (hook === 'useQueries' && arg.type === 'ObjectExpression') {
          const queries = arg.properties.find(
            (property) =>
              property.type === 'Property' &&
              !property.computed &&
              keyName(property.key) === 'queries',
          );
          if (queries && queries.value.type === 'ArrayExpression') {
            for (const element of queries.value.elements) {
              if (element) validate(element, hook);
            }
            return;
          }
        }
        validate(arg, hook);
      },
    };
  },
};
