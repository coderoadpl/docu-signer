import eventSuffixTaxonomy from './rules/event-suffix-taxonomy.js';
import queryDescriptorsOnly from './rules/query-descriptors-only.js';
import sxLayoutOnly from './rules/sx-layout-only.js';

export default {
  meta: { name: 'eslint-plugin-agentproofarch', version: '0.0.0' },
  rules: {
    'event-suffix-taxonomy': eventSuffixTaxonomy,
    'query-descriptors-only': queryDescriptorsOnly,
    'sx-layout-only': sxLayoutOnly,
  },
};
