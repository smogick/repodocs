// Entry for the vendored Milkdown Crepe bundle (public/vendor/crepe/).
// Rebuild with `npm run build:vendor` after changing this file or bumping
// @milkdown/crepe. The app only needs the Crepe class plus replaceAll to
// swap a document in without recreating the editor. The Latex feature is
// not used, so katex is aliased to a stub in the build script and its
// stylesheet is not imported here (that's why the common theme is listed
// file by file instead of via theme/common/style.css).
import { Crepe } from '@milkdown/crepe';
import { replaceAll } from '@milkdown/kit/utils';
import '@milkdown/crepe/theme/common/prosemirror.css';
import '@milkdown/crepe/theme/common/reset.css';
import '@milkdown/crepe/theme/common/block-edit.css';
import '@milkdown/crepe/theme/common/code-mirror.css';
import '@milkdown/crepe/theme/common/cursor.css';
import '@milkdown/crepe/theme/common/image-block.css';
import '@milkdown/crepe/theme/common/link-tooltip.css';
import '@milkdown/crepe/theme/common/list-item.css';
import '@milkdown/crepe/theme/common/placeholder.css';
import '@milkdown/crepe/theme/common/table.css';
import '@milkdown/crepe/theme/common/toolbar.css';

window.Crepe = Crepe;
window.milkdownReplaceAll = replaceAll;
