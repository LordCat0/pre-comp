// TODO: Extract this and TurboWarp/scratch-vm's compression to a shared module

// We don't generate new IDs using numbers at this time because their enumeration
// order can affect script execution order as they always come first.
// https://tc39.es/ecma262/#sec-ordinaryownpropertykeys
const SOUP = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#%()*+,-./:;=?@[]^_`{|}~';
const generateId = (i, soup = SOUP) => {
  let str = '';
  while (i >= 0) {
    str = soup[i % soup.length] + str;
    i = Math.floor(i / soup.length) - 1;
  }
  return str;
};

const NAME_SOUP = 'abcdefghijklmnopqrstuvwxyz';

class Pool {
  constructor(soup = SOUP) {
    this.soup = soup;
    this.generatedIds = new Map();
    this.references = new Map();
    this.skippedIds = new Set();
    // IDs in Object.keys(vm.runtime.monitorBlocks._blocks) already have meaning, so make sure to skip those
    // We don't bother listing many here because most would take more than ten million items to be used
    if (soup === SOUP) {
      this.skip('of');
    }
  }
  skip (id) {
    this.skippedIds.add(id);
  }
  addReference(id) {
    const currentCount = this.references.get(id) || 0;
    this.references.set(id, currentCount + 1);
  }
  generateNewIds() {
    const entries = Array.from(this.references.entries());
    // The most used original IDs should get the shortest new IDs.
    entries.sort((a, b) => b[1] - a[1]);

    let i = 0;
    for (const entry of entries) {
      const oldId = entry[0];

      let newId = generateId(i, this.soup);
      while (this.skippedIds.has(newId)) {
        i++;
        newId = generateId(i, this.soup);
      }

      this.generatedIds.set(oldId, newId);
      i++;
    }
  }
  getNewId(originalId) {
    if (this.generatedIds.has(originalId)) {
      return this.generatedIds.get(originalId);
    }
    return originalId;
  }
}

const optimizeSb3Json = (projectData) => {
  // Note: we modify projectData in-place

  // Scan global attributes of the project so we can generate optimal IDs later
  const blockPool = new Pool();
  const variableNames = new Pool(NAME_SOUP);
  const broadcastNames = new Pool(NAME_SOUP);
  const procedureNames = [];
  let dynamicBroadcast = false;

  for (const target of projectData.targets) {
    const procedures = new Pool(NAME_SOUP);
    procedureNames.push(procedures);
    for (const variable of Object.values(target.variables)) {
      if (variable[2]) {
        variableNames.skip(variable[0]);
      }
    }
    for (const name of Object.values(target.broadcasts)) {
      broadcastNames.addReference(name.toLowerCase());
    }
    for (const block of Object.values(target.blocks)) {
      if (Array.isArray(block)) {
        continue;
      }
      if (block.opcode === 'sensing_of' && block.fields && block.fields.PROPERTY) {
        variableNames.skip(block.fields.PROPERTY[0]);
      }
      if (block.opcode === 'procedures_prototype' && block.mutation && block.mutation.proccode) {
        procedures.addReference(block.mutation.proccode);
      }
      if (block.opcode === 'event_broadcast' || block.opcode === 'event_broadcastandwait') {
        const input = block.inputs && block.inputs.BROADCAST_INPUT;
        const value = input && input[1];
        const menu = typeof value === 'string' && target.blocks[value];
        if ((!Array.isArray(value) || value[0] !== 11) && (!menu || menu.opcode !== 'event_broadcast_menu')) {
          dynamicBroadcast = true;
        }
      }
    }
  }

  for (const [targetIndex, target] of projectData.targets.entries()) {
    for (const variable of Object.values(target.variables)) {
      if (!variableNames.skippedIds.has(variable[0])) {
        variableNames.addReference(variable[0]);
      }
    }
    for (const [blockId, block] of Object.entries(target.blocks)) {
      blockPool.addReference(blockId);
      if (Array.isArray(block)) {
        continue;
      }

      if (block.opcode === 'procedures_call' && block.mutation &&
          procedureNames[targetIndex].references.has(block.mutation.proccode)) {
        procedureNames[targetIndex].addReference(block.mutation.proccode);
      }

      if (block.parent) {
        blockPool.addReference(block.parent);
      }
      if (block.next) {
        blockPool.addReference(block.next);
      }

      if (block.inputs) {
        for (const input of Object.values(block.inputs)) {
          for (let i = 1; i < input.length; i++) {
            const inputValue = input[i];
            if (typeof inputValue === 'string') {
              blockPool.addReference(inputValue);
            }
          }
        }
      }
    }
  }

  blockPool.generateNewIds();
  variableNames.generateNewIds();
  if (!dynamicBroadcast) {
    broadcastNames.generateNewIds();
  }
  for (const procedures of procedureNames) {
    procedures.generateNewIds();
  }

  if (projectData.monitors) {
    for (const monitor of projectData.monitors) {
      // Remove redundant monitor values
      monitor.value = Array.isArray(monitor.value) ? [] : 0;
      if (monitor.opcode === 'data_variable' && monitor.params) {
        monitor.params.VARIABLE = variableNames.getNewId(monitor.params.VARIABLE);
      }
    }
  }

  // Use gathered data to optimize the project
  for (const [targetIndex, target] of projectData.targets.entries()) {
    const newBlocks = {};
    const newComments = {};
    const procedures = procedureNames[targetIndex];

    for (const variable of Object.values(target.variables)) {
      variable[0] = variableNames.getNewId(variable[0]);
    }
    for (const [id, name] of Object.entries(target.broadcasts)) {
      target.broadcasts[id] = broadcastNames.generatedIds.get(name.toLowerCase()) || name;
    }

    for (const [blockId, block] of Object.entries(target.blocks)) {
      newBlocks[blockPool.getNewId(blockId)] = block;
      if (Array.isArray(block)) {
        if (block[0] === 12) {
          block[1] = variableNames.getNewId(block[1]);
        }
        continue;
      }

      if (block.mutation && block.mutation.proccode) {
        const proccode = block.mutation.proccode;
        const newName = procedures.getNewId(proccode);
        if (newName !== proccode) {
          block.mutation.proccode = newName +
            (proccode.match(/%[a-z]/g) || []).map((argument) => ` ${argument}`).join('');
        }
      }
      if (block.fields) {
        for (const [name, field] of Object.entries(block.fields)) {
          if (name === 'VARIABLE') {
            field[0] = variableNames.getNewId(field[0]);
          }
          if (name === 'BROADCAST_OPTION' && typeof field[0] === 'string') {
            field[0] = broadcastNames.generatedIds.get(field[0].toLowerCase()) || field[0];
          }
        }
      }

      if (block.parent) {
        block.parent = blockPool.getNewId(block.parent);
      }
      if (block.next) {
        block.next = blockPool.getNewId(block.next);
      }

      if (block.inputs) {
        for (const input of Object.values(block.inputs)) {
          for (let i = 1; i < input.length; i++) {
            const inputValue = input[i];
            if (typeof inputValue === 'string') {
              input[i] = blockPool.getNewId(inputValue);
            } else if (Array.isArray(inputValue)) {
              if (inputValue[0] === 12) {
                inputValue[1] = variableNames.getNewId(inputValue[1]);
              }
              if (inputValue[0] === 11 && typeof inputValue[1] === 'string') {
                inputValue[1] = broadcastNames.generatedIds.get(inputValue[1].toLowerCase()) || inputValue[1];
              }
            }
          }
        }
      }
      if (!block.shadow) {
        delete block.shadow;
      }
      if (!block.topLevel) {
        delete block.topLevel;
      }
      delete block.x;
      delete block.y;
      delete block.comment;
    }
    if (target.comments) {
      for (const [commentId, comment] of Object.entries(target.comments)) {
        const text = comment.text;
        const isSpecial = text.includes(' // _twconfig_') || text.includes(' // _gamepad_');
        if (isSpecial) {
          newComments[commentId] = comment;
        }
      }
    }

    target.blocks = newBlocks;
    target.comments = newComments;
  }

  // Remove unnecessary metadata
  if (projectData.meta) {
    delete projectData.meta.agent;
    delete projectData.meta.vm;
  }

  return projectData;
};

export default optimizeSb3Json;
