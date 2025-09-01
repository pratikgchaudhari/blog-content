### Vue.js Event Modifiers

Vue.js provides event modifiers to simplify event handling in templates. These modifiers are added to event directives (e.g., `v-on:click` or `@click`) using dot notation (e.g., `@click.stop`).
1. **.stop**  
   Prevents event propagation, equivalent to calling `event.stopPropagation()`. Stops the event from bubbling up to parent elements.

2. **.prevent**  
   Prevents the default behavior of an event, equivalent to calling `event.preventDefault()`. For example, prevents a form submission or link navigation.

3. **.capture**  
   Uses event capturing mode instead of bubbling. The event is handled by the parent element before the target element.

4. **.self**  
   Triggers the event handler only if the event target is the element itself, not its children.

5. **.once**  
   Ensures the event handler is executed only once, then removed automatically.

6. **.passive**  
   Improves scrolling performance for touch/wheel events by indicating that the handler won’t call `preventDefault()`. Equivalent to `{ passive: true }`.