import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import Header from "./Header";
import "./StorefrontFrame.css";

const PRIMARY_A =
  "M0 0V324.8C120.0 433.1 253.3 460.1 400.0 406.0C546.7 351.9 680.0 340.3 800.0 371.2C920.0 402.1 1053.3 394.4 1200.0 348.0C1320.0 310.0 1400.0 270.7 1440.0 232.0V0H0Z";
const PRIMARY_B =
  "M0 0V334.0C136.0 420.0 271.3 444.0 418.0 396.0C564.7 348.0 696.0 361.0 816.0 385.0C936.0 409.0 1094.0 370.0 1214.0 338.0C1320.0 309.7 1402.0 280.0 1440.0 242.0V0H0Z";
const PRIMARY_C =
  "M0 0V316.0C104.0 444.0 235.3 474.0 382.0 414.0C528.7 354.0 664.0 322.0 784.0 358.0C904.0 394.0 1066.0 398.0 1186.0 356.0C1320.0 309.1 1398.0 262.0 1440.0 224.0V0H0Z";
const SECONDARY_A =
  "M0 0V335.8C132.0 445.1 268.0 469.1 412.0 395.0C536.0 331.2 668.0 351.3 788.0 384.2C934.0 424.2 1066.0 383.4 1188.0 335.0C1310.0 286.6 1392.0 283.7 1440.0 241.0V0H0Z";
const SECONDARY_B =
  "M0 0V328.0C118.0 436.0 252.0 469.0 398.0 403.0C544.0 337.0 684.0 366.0 804.0 392.0C924.0 418.0 1080.0 370.0 1202.0 328.0C1324.0 286.0 1402.0 290.0 1440.0 246.0V0H0Z";
const SECONDARY_C =
  "M0 0V342.0C146.0 452.0 282.0 468.0 426.0 388.0C570.0 308.0 654.0 338.0 774.0 376.0C894.0 414.0 1052.0 395.0 1174.0 341.0C1296.0 287.0 1382.0 276.0 1440.0 236.0V0H0Z";

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
                    x: [-3, 0, 3],
                    y: [-1.5, 0, 1.5],
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
                    y: [-1, 0, 1],
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
