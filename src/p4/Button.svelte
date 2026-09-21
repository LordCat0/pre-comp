<script>
  import {ACCENT_COLOR} from '../packager/brand';
  export let secondary;
  export let dangerous;
  export let text;

  const accent = parseInt(ACCENT_COLOR.substring(1), 16);
  const accentIsBright =
    (((accent >> 16) & 255) * 299 + ((accent >> 8) & 255) * 587 + (accent & 255) * 114) / 1000 > 128;

  const getColor = () => {
    if (secondary) return '#0FBD8C';
    if (dangerous) return '#FF8C1A';
    return ACCENT_COLOR;
  };

  const getTextColor = () => {
    if (secondary || dangerous) {
      return 'white';
    }

    if (accentIsBright) {
      return '#282828'
    }

    return 'white';
  };
</script>

<style>
  button {
    position: relative;
    font-family: inherit;
    font-size: 14px;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    margin: 0;
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    font-family: inherit;
    font-weight: bold;
  }
  .text {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    z-index: 10;
  }
  /* Because we want color to be settable from brand.js, it becomes complicated to make it dim while active */
  .dimmer {
    display: none;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.25);
  }
  button:active .dimmer {
    display: block;
  }
</style>

<button on:click style:background-color={getColor()} style:color={getTextColor()}>
  <div class="dimmer"></div>
  <div class="text">{text}</div>
</button>
