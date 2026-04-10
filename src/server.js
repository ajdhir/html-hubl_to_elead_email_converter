'use strict';
const express = require('express');
const path = require('path');
const { convert } = require('./converter');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/api/convert', (req, res) => {
  const { html, strict = true, stripWrappers = true, removeResponsiveCSS = true } = req.body || {};
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "html" field.' });
  }
  try {
    const result = convert(html, { strict, stripWrappers, removeResponsiveCSS });
    return res.json({ output: result.output, validation: result.validation });
  } catch (err) {
    if (err.validation) {
      return res.status(422).json({ error: err.message, validation: err.validation });
    }
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`eLead email converter running at http://localhost:${PORT}`));

module.exports = app;
