const importStartPlaygroundWeb = import('https://unpkg.com/@wp-playground/client/index.js');
const fetchBlueprintSchema = fetch('https://unpkg.com/@wp-playground/blueprints/blueprint-schema.json').then(r=>r.json());

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

	while (line[indent] == ' ' || line[indent] == '  ') {
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

    while (lines[checkRow][indent] == ' ' || lines[checkRow][indent] == '  ') {
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

const completeStepProperty = async (stepType, prefix) => {
  const schema = await fetchBlueprintSchema;
  return schema.definitions.StepDefinition.oneOf
  .filter(s => s.properties.step['const'] === stepType)
  .map(s => Object.keys(s.properties))
  .flat()
  .filter(s => s.substr(0, prefix.length) === prefix)
  .filter(s => !['step', 'progress'].includes(s));
};

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

const getCompletions = async (editor, session, pos, prefix, callback) => {
  const list = [];
  const prevKey = getPrevKeys(editor, pos);

  const content = editor.getValue();
  const lines = content.split("\n");
  const line = String(lines[pos.row]);
  const colon = line.indexOf(':');

  switch (prevKey[0]) {
    case 'preferredVersions':
      list.push('wp', 'php');
      break;

    case 'wp':
      list.push('latest');
      break;

    case 'php':
      list.push(...await completePhpVersion(prefix));
      break;

    case 'steps': {
      const stepType = getLastOfType(editor, 'step', pos);
      if(stepType) {
        list.push(...await completeStepProperty(stepType, prefix));
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
              list.push(...await completeStepSubProperty(stepType, resType, prevKey[-2 + prevKey.length], null, prefix));
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

  const {row,column} = pos;

  const qA = (!lines[row][-1 + column] || lines[row][-1 + column] === ' ') ? '"' : '';
  const qB = (!lines[row][column] || lines[row][column] === ' ') ? '"' : '';

  for (const fill of list) {
    callback(null, [{name: fill, value: qA + fill + qB, score: 1, meta: "Blueprint Schema"}]);
  }
};

let errorTag;
const showError = (error) => {
  console.error(error);
  if(!errorTag) errorTag = document.getElementById('error-output');
  errorTag.innerText = String(error);
}
const clearError = (error) => {
  if(!errorTag) errorTag = document.getElementById('error-output');
  errorTag.innerText = '';
}

const runBlueprint = async (editor) => {
  try {
    clearError();
    window.location.hash = JSON.stringify(JSON.parse(editor.getValue()));
    const blueprintJsonObject = JSON.parse(editor.getValue());
    const startPlaygroundWeb = (await importStartPlaygroundWeb).startPlaygroundWeb;
    await startPlaygroundWeb({
      iframe: document.getElementById('wp-playground'),
      remoteUrl: `https://playground.wordpress.net/remote.html`,
      blueprint: blueprintJsonObject,
    });
  } catch (error) {
    showError(error);
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

const formatJson = (editor, jsonObject = {}) => {
  const existing = editor.getSession().getValue();
  const formatted = JSON.stringify(jsonObject, null, 2) + "\n";
  if(formatted !== existing) {
    editor.getSession().setValue(formatted)
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const iframeSrc = "https://playground.wordpress.net/";
  const iframe = document.querySelector("iframe");
  const textarea = document.querySelector("#jsontext");
  const button = document.querySelector("button#run");
  const newTab = document.querySelector("button#new-tab");

  var editor = ace.edit('jsontext');
  editor.setTheme("ace/theme/github_dark");
  editor.session.setMode("ace/mode/json");

  const langTools = ace.require('ace/ext/language_tools');

  langTools.setCompleters([]);

  langTools.addCompleter({
    triggerCharacters: ['"'],
    getCompletions
  });

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
      win: 'Ctrl-Enter',
      mac: 'Command-Enter'
    },
    exec: editor => runBlueprint(editor),
    readOnly: false
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

  newTab.addEventListener('click', () => {
    const query = new URLSearchParams();
    const content = editor.getValue();
    const blueprint = JSON.parse(content);
    query.set('mode', 'seamless');
    query.set('php', blueprint?.preferredVersions?.php);
    query.set('wp', blueprint?.preferredVersions?.wp);
    window.open(
      `https://playground.wordpress.net/?${query}#` + JSON.stringify(JSON.parse(editor.getValue())),
      'blueprint-preview',
    );
  });

  if (window.location.hash) {
    loadFromHash(editor);
  }
  else {
    formatJson(editor, {
      landingPage: "/wp-admin/",
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
