import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import Header from "./Header";
import "./StorefrontFrame.css";

const PRIMARY_A =
  "M0 0V324.8C120.0 433.1 253.3 460.1 400.0 406.0C546.7 351.9 680.0 340.3 800.0 371.2C920.0 402.1 1053.3 394.4 1200.0 348.0C1320.0 309.3 1400.0 270.7 1440 232.0V0H0Z";
const PRIMARY_B =
  "M0 0V341.0C148.0 409.0 289.0 436.0 432.0 386.0C578.0 374.0 714.0 368.0 834.0 395.0C956.0 380.0 1087.0 370.0 1228.0 332.0C1344.0 329.0 1420.0 291.0 1440 248.0V0H0Z";
const PRIMARY_C =
  "M0 0V310.0C94.0 445.0 220.0 474.0 370.0 422.0C516.0 332.0 646.0 316.0 766.0 347.0C886.0 424.0 1020.0 415.0 1170.0 364.0C1294.0 291.0 1380.0 252.0 1440 218.0V0H0Z";
const SECONDARY_A =
  "M0 0V335.8C132.0 445.1 268.0 469.1 412.0 395.0C536.0 339.9 668.0 351.3 788.0 384.2C934.0 413.1 1066.0 383.4 1188.0 335.0C1310.0 320.3 1392.0 283.7 1440 241.0V0H0Z";
const SECONDARY_B =
  "M0 0V322.0C104.0 428.0 234.0 451.0 382.0 412.0C566.0 357.0 702.0 371.0 822.0 402.0C898.0 393.0 1032.0 364.0 1218.0 320.0C1336.0 335.0 1414.0 298.0 1440 254.0V0H0Z";
const SECONDARY_C =
  "M0 0V349.0C162.0 459.0 300.0 482.0 442.0 379.0C506.0 323.0 636.0 333.0 754.0 366.0C964.0 431.0 1098.0 401.0 1156.0 349.0C1284.0 306.0 1370.0 268.0 1440 229.0V0H0Z";

interface StorefrontFrameProps {
  children: ReactNode;
  className?: string;
  headerVariant?: "storefront" | "admin";
}

export default function StorefrontFrame({
  children,
  className = "",
  headerVariant = "storefront",
}: StorefrontFrameProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className={`storefront-frame ${className}`.trim()}>
      <div className="storefront-frame__wave" aria-hidden="true">
        <svg
          viewBox="0 0 1440 434"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
        >
          <motion.path
            className="wave-secondary"
            d={SECONDARY_A}
            animate={
              shouldReduceMotion
                ? undefined
                : {
                    d: [SECONDARY_A, SECONDARY_B, SECONDARY_C],
                    x: [0, 5, -6],
                    y: [0, -2, 3],
                  }
            }
            transition={
              shouldReduceMotion
                ? undefined
                : {
                    duration: 8.5,
                    repeat: Infinity,
                    repeatType: "mirror",
                    ease: "easeInOut",
                  }
            }
          />
          <motion.path
            className="wave-primary"
            d={PRIMARY_A}
            animate={
              shouldReduceMotion
                ? undefined
                : {
                    d: [PRIMARY_A, PRIMARY_B, PRIMARY_C],
                    y: [0, -1.5, 1.5],
                  }
            }
            transition={
              shouldReduceMotion
                ? undefined
                : {
                    duration: 6.5,
                    repeat: Infinity,
                    repeatType: "mirror",
                    ease: "easeInOut",
                  }
            }
          />
        </svg>
      </div>

      <Header variant={headerVariant} />
      <div className="storefront-frame__scroll">{children}</div>
    </div>
  );
}
