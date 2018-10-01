import * as templates from './templates'
import * as utils from '@/utils'
import {
  DEFAULTS,
  INPUT_TAGS,
  EXCLUDED_ATTRIBUTES,
  VALIDATORS,
  MESSAGES
} from './constants'

/**
 * Instrument customer lead forms in-place
 *
 * @class THForm
 */
class THForm {
  /**
   * Creates an instance of THForm.
   * @param {*} selector
   * @param {*} form_id
   * @param {*} [options={}]
   * @memberof THForm
   */
  constructor(selector, form_id, options = {}) {
    this.options = Object.assign({}, DEFAULTS, options)
    this.selector = selector
    this.form_id = form_id
    this.init()
  }

  async init() {
    try {
      this.bindScope()
      await utils.ready(this.options.delay)
      this.checkForTrackingScript()
      await this.bindForm()
      this.setValidationMode()
      this.takeControlOfForm()
    } catch (error) {
      console.log(error.message)
    }
  }

  static _setScope(scope) {
    THForm.win = scope
    utils._setScope(scope)
  }

  bindScope() {
    this.window = THForm.win || window
    this.document = this.window.document
  }

  checkForTrackingScript() {
    if (!this.window.CATracker || !this.window.cat || !this.window.$util) {
      throw new ReferenceError(MESSAGES.catracker)
    }
  }

  setValidationMode() {
    if (!utils.testValidationSupport()) {
      this.options.customValidation = true
    }
  }

  takeControlOfForm() {
    return this.compose(
      this.cloneForm,
      this.setFormAttributes,
      this.resetRequired,
      this.mapInputs,
      this.convertInputs,
      this.addMessages,
      this.bindEventListeners,
      this.wrapForm,
      this.unbindInlineEvents,
      this.appendToParent,
      this.removeOriginalForm,
      this.removeNamingConflicts,
      this.addHiddenInputs,
      this.injectStylesheet
    )(this.$form)
  }

  compose(...fns) {
    return fns.reduceRight((f, g) => (...args) => f.call(this, g.call(this, ...args)))
  }

  bindForm() {
    return new Promise(async (resolve, reject) => {
      this.$form = await this.getForm()
      if (!this.$form) {
        reject(new Error(`No form found with selector "${this.selector}"`))
      } else {
        this.log(`Bound form with selector "${this.selector}"`)
        resolve(this.$form)
      }
    })
  }

  getForm() {
    return new Promise((resolve, reject) => {
      if (this.options.poll) {
        const interval = setInterval(() => {
          const $form = this.form()
          if ($form) {
            clearInterval(interval)
            resolve($form)
          }
        }, this.options.pollInterval)
      } else {
        const $form = this.form()
        resolve($form)
      }
    })
  }

  form() {
    return this.document.querySelector(this.selector)
  }

  log(message) {
    if (this.options.debug) {
      console.log(`%cTH -> ${message}`, 'color: teal')
    }
  }

  bindEventListeners($el) {
    $el.addEventListener('submit', this.onSubmit.bind(this))
    return $el
  }

  unbindInlineEvents($el) {
    const $all = $el.querySelectorAll('*')
    for (let $element of $all) {
      const inlineEventListeners = [...$element.attributes]
        .map(({ name }) => name)
        .filter(name => {
          return /^on/i.test(name)
        })
      inlineEventListeners.map(attr => {
        $element.removeAttribute(attr)
      })
    }
    return $el
  }

  cloneForm($el) {
    this.$clone = $el.cloneNode(true)
    this.$inputs = this.$clone.querySelectorAll(INPUT_TAGS.join())
    return this.$clone
  }

  wrapForm($el) {
    const $wrapper = this.document.createElement('div')
    $wrapper.classList.add('th-form-wrapper')
    $wrapper.appendChild($el)
    return $wrapper
  }

  setFormAttributes($el) {
    $el.setAttribute('action', this.options.action)
    const action = this.options.customValidation
      ? 'set'
      : 'remove'
    $el[`${action}Attribute`]('novalidate', true)
    this.setFormId($el)
    return $el
  }

  setFormId($el) {
    if (!$el.id) {
      $el.id = `thrivehive-form-${(new Date()).getTime()}`
    }
    return $el
  }

  resetRequired($el) {
    $el.querySelectorAll('input')
      .forEach($input => {
        $input.required = false
      })
    return $el
  }

  mapInputs($el) {
    const mappedInputs = this.options.mappedInputs
    if (mappedInputs.length) {
      mappedInputs.map(input => {
        const selector = input.name
          ? `[name="${input.name}"]`
          : input.selector
        const $input = $el.querySelector(selector)
        if ($input) {
          if ('newName' in input) {
            $input.name = input.newName
          }
          if ('required' in input) {
            $input.required = input.required
          }
        }
      })
    }
    return $el
  }

  convertInputs($el) {
    this.$inputs.forEach($input => {
      const rules = utils.getInputRules($input.name, true)
      for (let key in rules) {
        if (!EXCLUDED_ATTRIBUTES.includes(key)) {
          $input.setAttribute(key, rules[key])
        }
      }
    })
    return $el
  }

  addMessages($el) {
    const messages = {
      $success: utils.htmlToNode(
        templates.successMessage(MESSAGES.success)
      ),
      $error: utils.htmlToNode(
        templates.errorMessage(MESSAGES.error)
      ),
      $warning: utils.htmlToNode(
        templates.errorMessage(MESSAGES.error)
      ),
      $loading: utils.htmlToNode(
        templates.loading(MESSAGES.loading)
      )
    }
    Object.assign(this, messages)
    utils.appendChild($el, ...utils.hideElement(...Object.values(messages)))
    return $el
  }

  addHiddenInputs() {
    const $form = this.$clone
    const $util = this.window.$util
    const tracker_id = this.window.cat.GetTrackerID()
    $util.SetFormHiddenID('CA-uid', $form.id)
    $util.SetFormSessionID('CA-sess', $form.id)
    $util.AddHiddenFieldInForm('meta.form-id', $form.id, this.form_id)
    $util.AddHiddenFieldInForm('meta.trackerid', $form.id, tracker_id)
    return this
  }

  removeNamingConflicts() {
    const $form = this.$clone
    const hidden_inputs = [
      'meta.form-id',
      'meta.trackerid',
      'CA-uid',
      'CA-sess'
    ]
    hidden_inputs.map(name => {
      const $input = $form.querySelector(`input[name="${name}"]`)
      if ($input) {
        this.log(`Found and resolved naming conflict with input name "${name}"`)
        utils.removeNode($input)
      }
    })
  }

  injectStylesheet() {
    this.$clone.parentNode.appendChild(
      utils.htmlToNode(
        templates.stylesheet()
      )
    )
  }

  appendToParent($el) {
    this.form().parentNode.appendChild($el)
    return $el
  }

  removeOriginalForm() {
    const $form = this.form()
    $form.parentNode.removeChild($form)
    return this
  }

  submit() {
    const response = this.onSubmit()
    if (typeof this.options.onSubmit === 'function') {
      this.options.onSubmit(response)
    }
    return response
  }

  async onSubmit(e) {
    e && e.preventDefault()
    utils.hideElement(this.$success, this.$error, this.$warning)
    const passed = this.validateAll()
    if (passed) {
      const data = utils.getFormData(this.$clone)
      utils.showElement(this.$loading)
      return utils.request(this.options.action, 'POST', data)
        .then((e) => {
          this.onSuccess(e)
        })
        .catch((e) => {
          this.onError(e)
        })
    }
  }

  onSuccess(e) {
    utils.hideElement(this.$loading)
    if (typeof this.options.onSuccess === 'function') {
      this.options.onSuccess(e)
    } else {
      utils.showElement(this.$success)
    }
    this.log(`Form submission successful`)
  }

  onError(e) {
    utils.hideElement(this.$loading)
    if (typeof this.options.onError === 'function') {
      this.options.onError(e)
    } else {
      utils.showElement(this.$error)
    }
    this.log(`Form submission error`, e)
  }

  validateAll() {
    if (this.options.customValidation) {
      let first_error = null
      const all_passed = [...this.$inputs].reduce((acc, $input) => {
        const validity = this.validateEach($input)
        if (!validity.value && !first_error) {
          first_error = validity
        }
        acc = validity.value
          ? acc
          : false
        return acc
      }, true)
      if (!all_passed) {
        const template = templates.warningMessage(first_error.message)
        this.$warning = utils.replaceNode(this.$warning, template)
        utils.showElement(this.$warning)
      }
      return all_passed
    } else {
      return true
    }
  }

  validateEach($input) {
    const { value, required } = $input
    if (required || value) {
      const name = $input.name && $input.name
        .toLowerCase()
        .replace('_', ' ')
      const message = name
        ? MESSAGES.requiredNamed(name)
        : MESSAGES.required
      const passed = required && !value
        ? {
          value: false,
          message }
        : this.validate($input)
      return passed
    } else {
      return {
        value: true
      }
    }
  }

  validate($input) {
    let passed = {
      value: true
    }
    const { value, name } = $input
    const rules = utils.getInputRules($input.name)
    const attributes = Array.from($input.attributes)
      .filter(attr => {
        return Object.keys(VALIDATORS)
          .includes(attr.nodeName)
      })
      .map(attr => {
        return Object.assign({
          name: attr.nodeName,
          value: attr.nodeValue
        }, VALIDATORS[attr.nodeName])
      })
    if (attributes.length) {
      const results = attributes.map(attr => {
        return Object.assign({}, attr, {
          value: attr.test(attr.value, value),
          message: attr.message(attr.value, name)
        })
      })
      const failure = results.find(result => !result.value)
      if (failure) {
        passed.value = failure.value
        passed.message = failure.message
      }
    }
    if (rules && passed.value) {
      const { pattern, test } = rules
      if (pattern) {
        const regex = new RegExp(pattern)
        passed.value = regex.test(value)
      }
      if (test) {
        passed.value = test(value)
      }
      passed.message = rules.title
    }
    return passed
  }
}

export default THForm