//*/ // Prod
const importStartPlaygroundWeb = import('https://unpkg.com/@wp-playground/client/index.js');
const fetchBlueprintSchema = fetch('https://unpkg.com/@wp-playground/blueprints/blueprint-schema.json').then(r=>r.json());
/*/ // Dev
const importStartPlaygroundWeb = import('http://localhost:8080/client/index.js');
const fetchBlueprintSchema = fetch('http://localhost:8080/blueprints/blueprint-schema.json').then(r=>r.json());
//*/

const FALLBACK_TIMEOUT = 30*1000;

const deref = (obj, root) => {
	if (!obj || typeof obj !== 'object' || !('$ref' in obj)) {
		return obj;
	}

	const path = obj['$ref'].substr(2).split('/');
	let node = root;

	for (const p of path) {
		if (!(p in node)) {
			throw new Error(`Invalid reference: "${obj['$ref']}"`);
		}
		node = node[p];
	}

	return {...obj, ...node};
};

const reader = Symbol('reader');

const getSchemaReader = (schema, root = null) => {

	if (schema[reader]) {
		return schema[reader];
	}

	if (!root) {
		root = schema;
	}

	const proxy = new Proxy(schema, {get: (target, key, receiver) => {
		const val = Reflect.get(target, key, receiver);
		if (val && typeof val === 'object') {
			return getSchemaReader(deref(val, root), root);
		}
		return val;
	}});

	schema[reader] = proxy;

	return proxy;
};

const getPrevKeys = (editor, {column, row}) => {
	const content = editor.getValue();
	const lines = content.split("\n");
	const line = String(lines[row]);
	const colon = line.indexOf(':');

  const path = [];

	if (colon > -1 && column > colon) {
		const openQuote = line.indexOf('"');
		const closeQuote =  line.indexOf('"', 1 + openQuote);
		path.push(line.substring(1 + openQuote, closeQuote));
	}

	let indent = 0;

	while (line[indent] == ' ' || line[indent] == "\t") {
		indent++;
	}

	checkRow = -1 + row;

  while(checkRow >= 0) {
		const openQuote = lines[checkRow].indexOf('"');
		const closeQuote = lines[checkRow].indexOf('"', 1 + openQuote);
		if(openQuote > -1 && openQuote < indent) {
      path.push(lines[checkRow].substring(1 + openQuote, closeQuote));
      indent = openQuote;
		}
		checkRow--;
	}

	return path;
};

const getLastOfType = (editor, type, {column, row}, skip = 0) => {
  const content = editor.getValue();
  const lines = content.split("\n");

  checkRow = -1 + row;

  while(checkRow >= 0) {
    const openBracket = lines[checkRow].indexOf('{');

    if(openBracket > -1) {
      if(--skip < 0) {
        return null;
      }
      checkRow--;
      continue;
    }

    let indent = 0;

    while (lines[checkRow][indent] == ' ' || lines[checkRow][indent] == "\t") {
      indent++;
    }

    const openQuote = lines[checkRow].indexOf('"');
    const closeQuote = lines[checkRow].indexOf('"', 1 + openQuote);
    const openVQuote = lines[checkRow].indexOf('"', 1 + closeQuote);
    const closeVQuote = lines[checkRow].indexOf('"', 1 + openVQuote);

    if(openQuote > -1 && openQuote == indent) {
      const checkType = lines[checkRow].substring(1 + openQuote, closeQuote);
      if (type === checkType) {
        return lines[checkRow].substring(1 + openVQuote, closeVQuote);
      }
    }

    checkRow--;
  }

  return null;
};

const getPrevSiblings = (editor, {column, row}) => {
  const content = editor.getValue();
  const lines = content.split("\n");

  checkRow = -1 + row;
  let indent = 0;

  while (lines[row][indent] == ' ' || lines[row][indent] == "\t") {
    indent++;
  }

  const siblings = [];

  while(checkRow >= 0) {
    const openBracket = lines[checkRow].indexOf('{');

    if(openBracket > -1 && openBracket < indent) {
      break;
    }

    const openQuote = lines[checkRow].indexOf('"');
    const closeQuote = lines[checkRow].indexOf('"', 1 + openQuote);

    if(openQuote > -1 && openQuote == indent) {
      siblings.push(lines[checkRow].substring(1 + openQuote, closeQuote))
    }

    checkRow--;
  }

  return siblings;
};

const getStepProperties = async (stepType) => {
  const schema = await fetchBlueprintSchema;
  const reader = getSchemaReader(schema);
  return reader.definitions.StepDefinition.oneOf
  .filter(s => s.properties.step['const'] === stepType)
  .map(s => s.properties)
  .flat()
  .pop();
}

const completeStepProperty = async (stepType, prefix) => {
  const schema = await fetchBlueprintSchema;
  return schema.definitions.StepDefinition.oneOf
  .filter(s => s.properties.step['const'] === stepType)
  .map(s => Object.keys(s.properties))
  .flat()
  .filter(s => s.substr(0, prefix.length) === prefix)
  .filter(s => !['step', 'progress'].includes(s));
};

const getStepSubProperties = async(stepType, resType, property) => {
  const schema = await fetchBlueprintSchema;
  const reader = getSchemaReader(schema);
  return reader.definitions.StepDefinition.oneOf
  .filter(s => s.properties.step['const'] === stepType)
  .map(s => {
    return s.properties[property].anyOf;
  })
  .flat()
  .filter(s => !resType || s.properties.resource.const === resType)
  .map(s => s.properties)
  .flat()
  .pop();
}

const completeStepSubProperty = async (stepType, resType, property, subKey, prefix) => {
  if(!resType && !subKey) {
    return ['resource'];
  }
  const schema = await fetchBlueprintSchema;
  const reader = getSchemaReader(schema);
  return reader.definitions.StepDefinition.oneOf
  .filter(s => s.properties.step['const'] === stepType)
  .map(s => {
    return s.properties[property].anyOf;
  })
  .flat()
  .filter(s => !resType || s.properties.resource.const === resType)
  .map(s => {
    if(subKey === null) {
      return Object.keys(s.properties);
    }
    return s.properties.resource.const;
  })
  .flat()
  .filter(s => !['resource'].includes(s));
}

const completeStep = async(prefix) => {
  const schema = await fetchBlueprintSchema;
  return schema.definitions.StepDefinition.oneOf
  .map(s => s.properties.step['const'])
  .filter(s => s.substr(0, prefix.length) === prefix);
};

const completePhpVersion = async (prefix) => {
  const schema = await fetchBlueprintSchema;
  return schema.definitions.SupportedPHPVersion.enum
  .filter(s => s.substr(0, prefix.length) === prefix);
};

const completeRootKey = async (prefix) => {
  const schema = await fetchBlueprintSchema;
  return Object.keys(schema.definitions.Blueprint.properties)
  .filter(s => s[0] !== '$' && s.substr(0, prefix.length) === prefix);
};

const completeFeature = async (prefix) => {
  const schema = await fetchBlueprintSchema;
  return Object.keys(schema.definitions.Blueprint.properties.features.properties)
  .filter(s => s[0] !== '$' && s.substr(0, prefix.length) === prefix);
};

let debounce = null;
let starting = null;

const getCompletions = async (editor, session, pos, prefix, callback) => {
  const list = [];
  const prevKey = getPrevKeys(editor, pos);

  const content = editor.getValue();
  const lines = content.split("\n");
  const line = String(lines[pos.row]);
  const colon = line.indexOf(':');

  const {row,column} = pos;

  const qA = (!lines[row][-1 + column] || lines[row][-1 + column] === ' ') ? '"' : '';
  const qB = (!lines[row][column] || lines[row][column] === ' ') ? '"' : '';

  if(prevKey.length === 3 && prefix.length >= 3 && prevKey.join('<') === 'slug<pluginZipFile<steps') {
    const wpParams = new URLSearchParams;
    wpParams.set('action', 'query_plugins');
    wpParams.set('request[page]', '1');
    wpParams.set('request[per_page]', '200');
    wpParams.set('request[locale]', 'en_US');
    wpParams.set('request[search]', prefix);
    wpParams.set('request[wp_version]', '6.4');
    const proxyParams = new URLSearchParams;

    proxyParams.set('url', `http://api.wordpress.org/plugins/info/1.2/?${wpParams}`);

    if (debounce) {
      clearTimeout(debounce);
      debounce = null;
    }

    document.body.setAttribute('data-loading', true);

    debounce = setTimeout(async () => {
      try {
        const res = await fetch(`https://playground.wordpress.net/plugin-proxy.php?${proxyParams}`);
        const json = await res.json();
        json?.plugins.map(p => {
          var doc = new DOMParser().parseFromString(p.name, "text/html");
          const meta = doc.documentElement.textContent;
          callback(null, [{name: p.slug, value: qA + p.slug + qB, score: 1, meta}]);
        });
      }
      finally {
        document.body.setAttribute('data-loading', false);
      }
    }, 250);
  }

  if(prevKey.length === 3 && prefix.length >= 3 && prevKey.join('<') === 'slug<themeZipFile<steps') {
    const wpParams = new URLSearchParams;
    wpParams.set('action', 'query_themes');
    wpParams.set('request[page]', '1');
    wpParams.set('request[per_page]', '200');
    wpParams.set('request[locale]', 'en_US');
    wpParams.set('request[search]', prefix);
    wpParams.set('request[wp_version]', '6.4');
    const proxyParams = new URLSearchParams;
    proxyParams.set('url', `http://api.wordpress.org/themes/info/1.2/?${wpParams}`);

    if (debounce) {
      clearTimeout(debounce);
      debounce = null;
    }

    document.body.setAttribute('data-loading', true);

    debounce = setTimeout(async () => {
      try {
        const res = await fetch(`https://playground.wordpress.net/plugin-proxy.php?${proxyParams}`);
        const json = await res.json();
        json?.themes.map(p => {
          var doc = new DOMParser().parseFromString(p.name, "text/html");
          const meta = doc.documentElement.textContent;
          callback(null, [{name: p.slug, value: qA + p.slug + qB, score: 1, meta}]);
        });
      }
      finally {
        document.body.setAttribute('data-loading', false);
      }
    }, 250);
  }

  switch (prevKey[0]) {
    case 'preferredVersions':
      const used = await getPrevSiblings(editor, pos);
      list.push(...['wp', 'php'].filter(s => !used.includes(s)));
      break;

    case 'wp':
      list.push('latest');
      break;

    case 'php':
      list.push(...await completePhpVersion(prefix));
      break;

    case 'steps': {
      const used = await getPrevSiblings(editor, pos);
      const stepType = getLastOfType(editor, 'step', pos);
      if(stepType) {
        const suggestions = await completeStepProperty(stepType, prefix)
        list.push(...(suggestions).filter(s => !used.includes(s)));
      }
      else {
        list.push('step');
      }
    }
    break;

    case 'step':
      list.push(...await completeStep(prefix));
      break;

    case 'features':
      list.push(...await completeFeature(prefix));
      break;

    case undefined:
      list.push(...await completeRootKey(prefix));
      break;

    default:
      switch (prevKey[-1 + prevKey.length]) {
        case 'steps': {
          const stepType = getLastOfType(editor, 'step', pos, 1);
          const resType = getLastOfType(editor, 'resource', pos, 1);
          if (prevKey.length === 2) {
            if (colon === -1) {
              const used = await getPrevSiblings(editor, pos);
              const suggestions = await completeStepSubProperty(stepType, resType, prevKey[-2 + prevKey.length], null, prefix);
              list.push(...suggestions.filter(s => !used.includes(s)));
            }
          }
          else if (prevKey.length === 3 && prevKey[0] === 'resource') {
            list.push(...await completeStepSubProperty(stepType, resType, prevKey[-2 + prevKey.length], prevKey[0], prefix));
          }
        }
        break;
      }

      break;
  }

  for (const fill of list) {
    callback(null, [{name: fill, value: qA + fill + qB, score: 1, meta: "Blueprint Schema"}]);
  }
};

let errorTag;
const showError = (error) => {
  console.error(error);
  if(!errorTag) errorTag = document.getElementById('error-output');
  const errDoc = `<head><style>body{ color: red; font-family: monospace; } pre{ white-space: pre-wrap; } p{ margin: 0.25rem; }</style></head><body>${error}</body>`;
  errorTag.setAttribute('srcdoc', errDoc);
}
const clearError = (error) => {
  if(!errorTag) errorTag = document.getElementById('error-output');
  errorTag.setAttribute('srcdoc', '');
}

const formatJson = (editor, jsonObject = {} ) => {
  const existing = editor.getSession().getValue();
  const formatted = JSON.stringify(jsonObject, null, 2) + "\n";
  if(formatted !== existing) {
    editor.getSession().setValue(formatted);
    if(formatted !== existing) {
      editor.getSession().setValue(formatted)
    }
  }
  // document.getElementById('jsontext').innerText = formatted;
};

function getCurrentBlueprint(editor) {
  const blueprint = JSON.parse(editor.getValue());
  if ( blueprint.features && blueprint.features.networking === false ) {
    blueprint.features.networking = true;
  }
  return blueprint;
}

const fetchBluePrintFromAI = async (editor) => {
  const description = document.getElementById('prompt').value;
  const blueprint = getCurrentBlueprint(editor);
  document.body.setAttribute('data-starting', true);
  document.getElementById( 'prompt' ).setAttribute('disabled', true);

  console.log( 'Calling AI', description, blueprint );
  const response = await fetch('https://public-api.wordpress.com/wpcom/v2/playground/ai/blueprint', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description,
      blueprint,
    }),
  });
  const json = await response.json();
  document.getElementById( 'prompt' ).removeAttribute('disabled');
  document.getElementById( 'prompt' ).innerText = '';
  console.log( 'Returned AI blueprint', json );
  return json;
};

const runBlueprint = async (editor) => {
  const fallback = setTimeout(() => {
    document.body.setAttribute('data-starting', false)
    starting = false;
  }, FALLBACK_TIMEOUT);
  try {
/*/ //<<<<<<< HEAD
    window.location.hash = JSON.stringify(JSON.parse(editor.getValue()));
    if (starting) {
      return;
    }
    starting = true;
    clearError();
    document.body.setAttribute('data-starting', true);
    const blueprintJsonObject = JSON.parse(editor.getValue());
    formatJson(editor, blueprintJsonObject);
/*/ //=======
    clearError();
    window.location.hash = JSON.stringify( getCurrentBlueprint(editor) );
    const blueprintCopy = JSON.parse( JSON.stringify( getCurrentBlueprint(editor) ) );
    delete blueprintCopy.features; // I am getting error otherwise
  
    //window.location.hash = JSON.stringify(JSON.parse(editor.getValue()));
    // const blueprintJsonObject = JSON.parse(editor.getValue());
    // formatJson(editor, blueprintJsonObject);
//*/ //>>>>>>> 0086b9e4666f2c2cdb5ed8a462509215cb5c1db7
    const startPlaygroundWeb = (await importStartPlaygroundWeb).startPlaygroundWeb;
    await startPlaygroundWeb({
      iframe: document.getElementById('wp-playground'),
      remoteUrl: `https://playground.wordpress.net/remote.html`,
      blueprint: blueprintCopy,
    });
    document.body.setAttribute('data-starting', false);
    clearTimeout(fallback);
    starting = false;
  }
  catch (error) {
    starting = false;
    document.body.setAttribute('data-starting', false);
    showError(error);
    clearTimeout(fallback);
  }
  finally {
    document.body.setAttribute('data-starting', false);
  }
};

const loadFromHash = (editor) => {
  const hash = decodeURI(window.location.hash.substr(1));
  try {
    formatJson(editor, JSON.parse(hash));
  } catch (error) {
    console.error(error);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const iframeSrc = "https://playground.wordpress.net/";
  const iframe = document.querySelector("iframe#wp-playground");
  const textarea = document.querySelector("#jsontext");
  const button = document.querySelector("button#run");
  const aiButton = document.querySelector("button#open-ai");
  const closeAi = document.querySelector("button#close-ai");
  const genButton = document.querySelector("button#generate");
  const newTab = document.querySelector("button#new-tab");
  const zIn  = document.querySelector("button#zoom-in");
  const zOut = document.querySelector("button#zoom-out");
  const zoomLevel = document.querySelector("span#zoom");

  let aiOpen = false;

  aiButton.addEventListener('click', event => {
    document.body.setAttribute('data-show-ai', aiOpen = !aiOpen);
  });

  closeAi.addEventListener('click', event => {
    document.body.setAttribute('data-show-ai', aiOpen = false);
  });

  const editor = ace.edit('jsontext');
  editor.setTheme("ace/theme/github_dark");
  editor.session.setMode("ace/mode/json");

  const langTools = ace.require('ace/ext/language_tools');

  langTools.setCompleters([]);

  langTools.addCompleter({triggerCharacters: ['"'],getCompletions});

  editor.setOptions({
    enableBasicAutocompletion: true,
    enableLiveAutocompletion: true,
    enableSnippets: true,
    useSoftTabs: true,
    tabSize: 2,
  });

  editor.commands.addCommand({
    name: 'Run Blueprint',
    bindKey: {
      win: 'Ctrl-Enter|Ctrl-S',
      mac: 'Command-Enter|Command-S'
    },
    exec: editor => runBlueprint(editor),
    readOnly: false
  });

  editor.getSession().on('change', async event => {
    if(event.action !== 'insert') {
      return;
    }

    const content = editor.getValue();
    const lines = content.split("\n");
    const quoteCount = (lines[event.start.row].match(/"/g) || []).length;

    if(event.start.row === event.end.row && 1 < Math.abs(event.start.column - event.end.column)) {
      if(lines[event.end.row][event.end.column] === '"') {
        editor.moveCursorTo(event.end.row, event.end.column + 1);
        return;
      }
    }

    if (lines[event.end.row][event.end.column]) {
      return;
    }

    const indent = (lines[event.start.row].match(/^(\s+)/g) || [''])[0];

    const inserted = event.lines.join("\n");
    const prevKey = getPrevKeys(editor, event.end);

    if (inserted.length > 1) {
      return;
    }

    if (inserted === ':') {
      const colon = lines[event.start.row].indexOf(':');
      if (colon > -1 && colon < event.start.column) {
        return;
      }

      if(prevKey.length === 1 && prevKey[0] === 'landingPage') {
        editor.getSession().insert({row: event.end.row, column: event.end.column},  ' ""');
        editor.moveCursorTo(event.end.row, 1 + event.end.column);
      }

      if(prevKey.length === 1 && prevKey[0] === 'preferredVersions') {
        editor.getSession().insert({row: event.end.row, column: event.end.column},  ' {}');
        editor.moveCursorTo(event.end.row, 1 + event.end.column);
      }

      if(prevKey.length === 2 && prevKey[1] === 'preferredVersions') {
        editor.getSession().insert({row: event.end.row, column: event.end.column},  ' ""');
        editor.moveCursorTo(event.end.row, 1 + event.end.column);
        setTimeout(() => editor.execCommand('startAutocomplete'), 0);
      }

      if(prevKey.length === 1 && (prevKey[0] === 'steps' || prevKey[0] === 'features')) {
        editor.getSession().insert({row: event.end.row, column: event.end.column},  ' []');
        editor.moveCursorTo(event.end.row, 1 + event.end.column);
      }

      if(prevKey.length === 3 && prevKey[2] === 'steps') {
        const stepType = getLastOfType(editor, 'step', event.end, 1);
        const resType = getLastOfType(editor, 'resource', event.end);
        const subProps = await getStepSubProperties(stepType, resType, prevKey[1]);
        const subProp = subProps[prevKey[0]];

        if (subProp?.type === 'string') {
          editor.getSession().insert({row: event.end.row, column: event.end.column},  ' ""');
          editor.moveCursorTo(event.end.row, 2 + event.end.column);
          editor.execCommand('startAutocomplete');
        }
        else if (subProp?.type === 'object') {
          editor.getSession().insert({row: event.end.row, column: event.end.column},  ' {}');
          editor.moveCursorTo(event.end.row, 2 + event.end.column);
        }
      }

      if(prevKey.length === 2 && prevKey[0] === 'step' && prevKey[1] === 'steps') {
        editor.getSession().insert({row: event.start.row, column: event.start.column + 1},  ' ""');
        editor.moveCursorTo(event.end.row, 1 + event.end.column);
        editor.execCommand('startAutocomplete');
      }
      else if(prevKey.length === 2 && prevKey[1] === 'steps') {
        const stepType = await getLastOfType(editor, 'step', event.end);
        const properties = await getStepProperties(stepType);
        const property = properties[ prevKey[0] ] ?? null;
        const propType = property.type ?? null;
        const propRef = property['$ref'];

        if (propType === 'string') {
          editor.getSession().insert({row: event.end.row, column: event.end.column},  ' ""');
          editor.moveCursorTo(event.end.row, 2 + event.end.column);
        }
        else if(propRef === '#/definitions/FileReference') {
          editor.getSession().insert({row: event.end.row, column: event.end.column},  ' {}');
          editor.moveCursorTo(event.end.row, 2 + event.end.column);
        }
      }
    }
    else if (inserted === '[') {
      editor.getSession().insert({row: event.end.row, column: event.start.column + 1},  "]");
      return;
    }
    else if (inserted === '{') {
      editor.getSession().insert({row: event.end.row, column: event.start.column + 1},  "}");
      return;
    }
    else if(inserted === ',') {
      const nextIndent = (lines[1 + event.start.row].match(/^(\s+)/g) || [''])[0];
      if(nextIndent.length >= indent.length) {
        return;
      }
      if (lines[event.start.row][-1 + event.start.column] !== '"') {
        editor.getSession().insert({row: event.end.row, column: event.end.column},  "\n" + indent);
        editor.moveCursorTo(1 + event.end.row, 1 + (indent.length));
        return;
      }
      editor.getSession().insert({row: event.end.row, column: event.end.column},  "\n" + indent + '""');
      editor.moveCursorTo(1 + event.end.row, 1 + (indent.length));
      editor.execCommand('startAutocomplete');
    }
  });

  window.test = {
    iframeSrc,
    iframe,
    textarea,
    button,
  };

  button.addEventListener('click', () => {
    try {
      clearError();
      runBlueprint(editor);
    }
    catch (error) {
      showError(error);
    }
  });

  genButton.addEventListener('click', () => {
    try {
      clearError();
      fetchBluePrintFromAI(editor).then( blueprint => {
        formatJson(editor, blueprint);
        runBlueprint(editor);
      } );
    }
    catch (error) {
      showError(error);
    }
  });

  let prevWin;

  newTab.addEventListener('click', () => {
    runBlueprint(editor);
    const query = new URLSearchParams();

    query.set('mode', 'seamless');
    // query.set('php', blueprint?.preferredVersions?.php);
    // query.set('wp', blueprint?.preferredVersions?.wp);
    const url = `https://playground.wordpress.net/?${query}#` + JSON.stringify(getCurrentBlueprint(editor));
    if (prevWin) {
      prevWin.close();
    }
    prevWin = window.open(url, '_blank');
  });

  let zoom = 1;

  zoomLevel.innerText = (100 * zoom).toFixed(0) + '%';

  zIn.addEventListener('click', () => {
    if (zoom > 3) {
      return;
    }
    zoom += 0.1;
    iframe.style.setProperty('--zoom', zoom);
    zoomLevel.innerText = (100 * zoom).toFixed(0) + '%';
  });

  zOut.addEventListener('click', () => {
    if (zoom < 0.35) {
      return;
    }
    zoom -= 0.1;
    iframe.style.setProperty('--zoom', zoom);
    zoomLevel.innerText = (100 * zoom).toFixed(0) + '%';
  });

  if (window.location.hash) {
    loadFromHash(editor);
  }
  else {
    formatJson(editor, {
      landingPage: "/wp-admin/",
      phpExtensionBundles: [
        "kitchen-sink"
      ],
      preferredVersions: {
        php: "7.4",
        wp: "5.9",
      },
      steps: [
        {
          step: "login",
          username: "admin",
          password: "password",
        },
      ],
    });
  }

  runBlueprint(editor);

  window.addEventListener('hashchange', () => {
    loadFromHash(editor);
    runBlueprint(editor);
  });
});
