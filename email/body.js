'use strict';

const sanitizeHtml = require('sanitize-html');

function formatEmailBody(text, richHtml = '') {
  const plainText = String(text || '');
  const escapedText = plainText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = richHtml ? sanitizeHtml(String(richHtml), {
    allowedTags: ['p', 'div', 'br', 'span', 'b', 'strong', 'i', 'em', 'u'],
    allowedAttributes: { '*': ['style'] },
    allowedStyles: {
      '*': {
        'font-size': [/^(?:1[0-9]|2[0-9]|3[0-9]|4[0-8])px$/],
        'font-weight': [/^(?:bold|normal|[1-9]00)$/],
        'font-style': [/^(?:italic|normal)$/],
        'text-decoration': [/^(?:underline|none)$/]
      }
    },
    transformTags: { font: 'span' }
  }) : escapedText.replace(/\r?\n/g, '<br>');
  return { text: plainText, html };
}

module.exports = { formatEmailBody };
