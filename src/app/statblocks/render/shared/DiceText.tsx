import React, { useContext, useMemo } from 'react';
import { diceLinkProps } from '../../../services/statblockDiceLinks';
import { splitDiceSegments } from '../../../services/statblockDiceText';
import { SheetContext } from '../sheetContext';

/**
 * Text as it reads, its dice notation and bare bonuses as roll links: the
 * React twin of `linkDiceIn`, for text no Markdown renderer drew. A die written without faces
 * is one where the statblock the text is in has a set that opts in (`SheetState.rollParse`).
 */
export function DiceText({ text }: { text: string }): React.JSX.Element {
  const rollParse = useContext(SheetContext)?.state.rollParse;
  const segments = useMemo(() => splitDiceSegments(text, rollParse), [text, rollParse]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.dice ? (
          <span key={index} {...diceLinkProps(segment.text)}>
            {segment.text}
          </span>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ),
      )}
    </>
  );
}
