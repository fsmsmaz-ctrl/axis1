'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { saveStoredToken } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, ArrowRight, Globe } from 'lucide-react'
import { toast } from 'sonner'

const AXIS_LOGO_WHITE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPsAAACQCAYAAADOQR0/AABBTUlEQVR4nO2dd5hkVZn/P9Xd08MQh5wkiBJERVAQxQQG0oogKuKKmdU1IuKuYVUMPxXWxbRGVAy4CKgIGFgji2JAQYIIgpLTEGcGJk93n98f3/PlnLp9K9+qroF+n+c+VXXr3pPfcN50aiEEZqEOxoAJ4DHAPsApQA2YmslGzcIs9AojM92AIQMj+lOA84EbgICQfRZmYY2GWWQX1EiIfjhC9AXAr9AYTc5c02ZhFqqBWWQXoo8gRD8W+D6wFvD57L9ZmIU1HmoP8z37CBLTA3AS8I74fRGwE3APQviH9SDNwkMDxma6ATMII0jpNoaUcK8AVgBzgbMRoo8yK8LPwkMEHq7IbiReB/gecCCwGhhHnPxrM9e0WZiF/sDDUYw3om8GnIM07xOI048AlwNPJIn3szALDwl4uCmfxhCib4c07kb0MZId/Rvx++gMtG8WZqFv8FDg7LXsMoTs099tWnsc8ENgexKi25a+BCnm7mBWMTcLDzFYE/fsNofVELK2ErdtQ18N7AmcB2yCOLz77+8/Qoi+pirmikSvFfRjq1IrfBZh0J6IzcakWf8bvVflmHU6X91CAMKahOxG8knqEXFDYD6wKbKPTwL3AfcD9yIN+2rgGcC58dlJ6sV0b2e+2q/GDwiGQc8QCp9FGKTE5Lq6qa8fY2m9UEBrcKDztaaI8TmnXQ94DnAQ8CS0/94AmJM9HxCS3wPcCPwDeAmwLuIsua7Cv68GdiNNwpoE5g5zgC1o7eLr/+8gSUdVwUZovsbjZ96WKeBWktmzn2BEXwfYOGvHOCL+k/H79Q3eXw8xEr/nz1XIu7IT8Hor9nk9xHzc3qrBbV4NLFgTOLsRfX3k4fYahOBFyKnkCDAP2CZez8ieKSoljezfJO3hJ6pr/kBgFLX5fcC7SP1oBP7/Y8CHqKbPRuDdkJVjBBEfL+LJeO8/kANTP8fZda4P/BrYhTT3o8BKYG3gs8Ax1DMTt+t1wInUK3BHgCuAvTpoS172jsABaD3ugixCGxbaXCW4zQuA3QghDPM1Fj+fF0L4R0gwEUJYHUKYDCFMxSsH35vMni0+kz+3LISwbaxrZAj63clVi9d6IYQFJX1sBneEENbNyui1LaPx892x/MkG9T6v8HzV4+F1c26sL597t+k3IYS5QfOd993vvrNBH67oYjweH0I4M4SwosF49BvuDSFsMsymN3Or1wI/Ax5FEjlHEbW1oq5IFX1vJHu2jHJOxvs/BW6Oz65poawWlY8ANqdeaRmQCLe65P4EEvmPII1pr2BF5wnA19H4r87qnIqfpyFriLl9leB1cwJwSKwf0j55BG3tDkcc3v8VIWTvFD/bbcck8Ebgj2gbOTe2bRKNxWT8vbpP16rsMwwrsnugDkPebFMk19YqxR2X9VUGpxmtGryA30rao+XXnHhZrM//C/G9KiP7rPz8V+C3se4pEvGdQtaQ76HFX+W4WwR/OWk7k28lasByhOh305q4F8ey3bbmiP4FEpIH6tewGdGcPl3j8XMjhlQb7wWxFeIO+T68SrDjzPXAz+O9Nc3c5kX1HOAJTHcGmkJjuATpOQ4jEQQv9N2B/YBfUo3J0RxxFfBi4GJga9L+0Zz3ScDJwKuoZv/ucvdExDu3uJgjjwGvBi6tqM5G7ZhC/hz/TZIejWu5gvhmpBi+Pd6fQIrlqsBzfSewaFiRfQL4N6SpbKVs6hY86KeihVmcfFPfNUEz/7b46T6Z2/8fcHT23E1IYenn3Le3I2SvCkx0FgAvQkqyXDPvsX4lcBnwKXpDPjOITUkhypYmICH68cCZiNutnl5MZRCA95MIUE50vI14DzIFL+tjO+pg2MR4O8rMQ3ucMu15FeA96mqE7DBdnDOHGrYxMhipd0aBPBYRDTUUkz+KTI4O8MlTbBkBD0Ta4aJZshcwgl2ECE5RavDvk5BkkiNFJ5CL1qcD21KvCzCzOB34MMnBqh/gOdkUOJh6XYjH/GbgmbE9y0iifL+voVvInrQdkBjfr+QRHvhfAtdRb/d1GzZEe8sqEaBKcJvejDiVEclc9QbgJ/H3crTwvh6/G8khIeWbqJ64GdFORQqznHvnSPodpiNpu2Ci8Vng2dQTDfftEmSy7XfWIfdnT5JPR+5jUAM+AtxC0ldYSdfva+gWsQdm0/jZT814jeQxN1K4D7KBXoQ457AhvBfJxsBR8V6Rg3wF7f+MDKNokZ2dve/3QixnY9Iesyowwr0H2d9zhM/F724Udi7rDcBbqN/ymejdiRRy3gv3c1vmdu9UqMtS1yrEYHIrxcBgmBYwpM7fT/+0414EtyLOly98/w9wDaLOP0HOGfSpPd1AjqAbokVu7fooUsh9Mz5bJJifi5+ee/d/Q7SHrsoMZ8hNXq8A/kqKPnRfJpCjypeY7srcCPze09F2paiQs3nxxQzerFp0+vK6XoDW3RQzoAsaVmS/AaWG6ocftSf8NKaLtAaPy0VoS/F5hou729XzTfH3SHa/BvwAaXjzBW6E+z2y++ZEzsq6N8ZyqxZ1Pb4PAC9EsQv51sn76FcjZWMrpazF8UcA32W6v0Vu/ruQeuIyCGjEFO5F/ZyRiMphWbwG7xkXogVpR4wqwRzhG/F3WfkeF5tEjkKLtF2u009wSO6BSFzM97n+/HyDd43UTqaZ359C7pz/xHRlXxVgP4m/A0dm9/IQ5Emkmd+Xxgo7I/U4Ev23oJ4Qm1CchBSSw+D+7D4uiZ8zIiEOG7JDapMPZ6gSzPkuRPbNVgEZ92TPnISsBK2CTPoNbu8x1HMHI/0fkERSpoxy/88ihfIW+39MoZ4qwYj4c2Tuyzlu7rRyOuLaZQo76yC+DOxNPVFw+T8C3sngOXoj8HrZJH7miruBwTAiey6KGiGrnrAyxVwRzD1AipVHIjFzJrPYeMuxO+J+vpeDuXpZ3/I9/TfivdwMN4WCNPak+r27wQj5WYSwZQq7zZF4bu83I4afPRbNxWqm5yS4GnnQuayZ8JNohMgboii8GYFhRHaL8quA46huf5NrZ8+N9xoRESt4rFW1+HsM9WaumYAyF1cj5u2ISBaVjjkYub+KfMNznYXF4bfSXyTxdujNyPGnTGH3FORq6meN6AcAn6Q++YjbvQhp3q3gnak4h+WF314/myETo+PaBwrDiOyQJvg8JM5X4QjhiT8DKYq89y2CJ2Z94Gnxnp/dGXgq/eN6zcAIvCXTg1eMKN8AllKudDTkbsI/pp4w+L0XIRfXfgSqQH1gzBHIoyzfUhixj0YEwcEjj0KK1TwGINfrvAz4GzMvvl8eP3MO77E8kP7EebSEYUV2SIvybSiGeA69KVqMGKdm38ui4xx082FS+qpcJDwge3eQ4Da/BpkEvd0x0q8kbU/a4Wg1Gpvh1gFeX/ivajA3vhtxY3NDEynvzT+DDtj01m4jyhVyxwL/y8wq5DzuFyK7fu6SbEL6XuQ3v5J69+Fur1GSNaIpDDOym/ovRZrwO+meYhsxfoYCM+y1lHMY31sbeXsdQ7323YRh96x9gwIj4TyEhLmnm/v2I2SybMee7HcuQFyoaIYDJW9YJ3u2H2BR/FK0B/fWJOfco8C3kDPQ46mfE0e1nYyIwkxr3nMfjnOpH9dcSfdrRJy2JvkDdHs5XDYnHKV4PWyBMLkyxlzLqYMOBn6BlBydmsBc1ibINn05QoxV8b91kNnpWcBLgUfTWBE3P34OEtm9jz0MOWzk/ffEfm76a03BAUdfQIqyPLpwEi3EFyPnnH4ikRH2THRM9gdJ/TNnfFS88jmxKHwBmtMqIvaqACPd+4FDSSG+5r4BreFPoixBlwNXIQnnRsTcOtFT3Y78Fm5BOotc2WlmBjCjOegsPrtj7UzU45GothW9m8CWkQZmbrwMZcTE4vyPUVKEQS4ubyN+j8xNXvQ24VyOQkahfaWUx24D4FrkslqMmrsUaeah/26mJmjfQQS3iNjFoJIa2p/vh6S+VmbUdsGE7Tjgv5ielupyknTXCLw2XoX0KHmILSRpskq9zz1oHv8PEU7rDR4cl5kQ40dICi+LzkaajRDnehLwZORC6c9dEfU6HFFC6HxyHTMckLi+frzmZv81mgQTlwvi70Ht2Y3U+yANddmi/zKde/i5nEXAt7PyXGdAJ+M8q1BnP8AcqIbE22XU73etUzG43ycgRDf3HBYws/gm8C/UewTm693rP88m1Onlfm+C1sh7UeDPt5D2/8F1MUjObk7ujs5DXOoZCLl3RJrmtannsoZJJHbfHcvaht64e7HjzcrxYpxEoaDXUx0naQXmEqcjjueF4/bfi8ZuEZ2bKd2HXYC/xLo8Dq7nHLR96Kckk6+NHwLPp9zX3cTMyH4zWj+3MFyc3eAxexIS2Q+iGgZrycBz7fHLJaAayqp8UPwcGdSe3Q2ZRAvzaGTeeVSD58sW7CgiENtm93rhrp28633lKQjRByXCe9y2R/u/orltDHHlRXS3r7YU8zekvDyYtLhNUA5G/gZ/p38EzqbVTzId0aHezJYv7O1QsopnUB8MNCzgflyC+rUb8Fwkqe6A9CJjSA80l/aZl7c9ORQl0tVI9/STWN8Dg0B2T8w48AHkJmkvIpu5cldJKO9wJ5w4h7z8TsGa0jkIyd/N4Dg6JCXa61H2lVwcNMH5CtN94zsBL5AvIMTOy5hEfX8jEq/7ETlmRH9drKMYpjqCosVuRls63/PY7IWI8MuZeW18GeS+ClfEyzAPjenGaH7bhQ2R2L4J8v04GBGSnFg4G8+OSFn4zn6nOXZa5keEEH6bpbZ1Guh+Q55C2CmlJ2LdeRrq/MrTTxuuDSHsFAabarqYItptC1nbzqm4zktjua7H43dvCGGjUF3K6WKq5Wdkc+M6p7J+7h/H4dZC+0IIYVX8fH+oTwXd7eX3jyuMteu8rIeyR2L5o30Yx/fH9k1kY+M1szCEsEU/ObsVLJujE1MfTfJlHtT2oYZsnpvQPuXMJYAVSNHxXrQ3HiRXt3b6pWgMizZ/0H56axpvK8ap3/c6y2yu+LJjxgRSPu5O/V5wEilOj0L+7FVxT+/Rt0XRa1YKum/epvw72mKATIG/Jq0t25UnkBPUVUisH0YOD0mSNTSTZJtB8b0plAFnM5TEw2vF25r5wGH9VNBZdPkFMo+spv6Ipn6CRfe7kLfSukhJsjvS6u+ABmajQptWIu3u3xCBOhvtVWGwiA5p6/FnJKKVWQmstW4Eua0aWvtkl2n0fe8aZPq0NaMXcN/mAr9Bc1N0lhlDhPZV1GuyX4tCV3Nx3wq85SiZxWV0r1epUkE3KPCcbYzSrK1HIobeRpzZLw7rAXs9g0d0SA4XpyD74z3IYeH72TNro8EpIvvdSOtv8D51kIjuhfpsylNEG9auuN4yQmAOvDPS7J5Lb5wzt6l/HSF6jrjm6Beh9eOxCKQ5fQL1SS7MwdZBLrVPpj48+aEOXh93o1z9B2b3TFgf3w9kNzVZG4m/gw4JtcZ6FSmbai4i2oS2jMZpfM0BbUEYNJhzvr3w2zDR4H43UCZClml7HfV3Lr0hkBVyH6TelAhprdyBrDUrqZdMTAiORVLGftR7200gy8UZSOuda/Ef6uC+XkbKNuz7AOv2w6nGk7M/Mo3k9tFBgH25zyNljrUjQ+7QYBNO8apR72AzaMht3wdQPn7We1Rxakij4IocQYz4+yJHm04dePJ2r0aRbsdTn3jCovgESiN+G9O1/7l9+UiUB78sWm4/6sNjHy4Q0Na1DNbuF2cHeB4F39wBgRfhF1o8NxNtaweM7G8kRfpZqVaLv99Pitmusg8ub2ckJpcpzN6C9s2dKpUsuj8RuZDmSqS8/KORKNpoq2DufxciChdSL7n5vTegRBbDECAzDDDRD2Q3lX0M3du3e6l7BGllf0XzJA7DCG7vxigTa9E1dgSlIj5hAG15IUoN5XqNUC9BR0PfQfvExgRsc5QSax71qZlM0D5Ne3njTBj+hPb136B+O+B9/qeRYnGmQ18HCZs0uL+yH+K1J3+j+DloZAfFdeci4poCRqijSNF9+fjZD34UmRJ7iYNudK0V6zmZtKVx3ZPIsnE07fvLm+CPoACN7dDc5CG6Y+gk3WNpP4zZyP1Nph8fle/Vv4McS9bE9dAJGO92anB/ST+Q3Yvz3kJl/QYvvgfQBENvXL1MSdVPMDLZYw3qfcFHkUXBp7yspLc46EbXKjSWpzA9643bczRSwLYT624u+0V07FGZQu4fKMtM7t/dDphQHIdMvDmhcFnzkQl1fXqPlBxmsG5nt/h7JLsPcH2/FHQg8WmQ+2IvvLOQe2VRydQpWGs/KOWi23sQ2jPndZu7fovpeeOqBiPg7chUmW+FbIbbBkUftuLu5rbHouivPEHkgxwHbRkWUi9JtANW2IGIxY3UK+xMaHYF/od6c9SaArU2rnHUt6ciKaZMgXppPxfyz7LGDALcl5N7LMeL901IyWObfb/BC/SYwn0j1Eqa57qvGmooIUaZNSAgBV4z5DSiH4wCXIpOMCZmrwSupPssRF7Y9yBz3QrqmYwVg88HPlFoRz+hkbWn2VXLPg2hjWsVykfwpZJ2WMI5ux/I7gn7OeIOg3Bs8ML5M0rwkIfSdgoe6GVo8F5C//d75tR7IPNW7ptgieWntJ92qldwnX9CmvF8PN3WvZC3Whl3N4LtTEoQmS9iI9z7kBNMr8ozi/N/pt4Rx+Dy34ly+OUSRr/AUkcnVzF0FRIBsKl1HCk414nXFkjH83vkLZoTZ0cC/i9waT86bE+npegw+o/Tf3HYg3MKafF1ixB+749osL6F9pSX0l/CFZBZy34BHi8jyJcLv/sN7ut/I6TOwdz07cjdtey99dFeeQPK88adDnyU6rTkLvdUtG99J+Ua+pORC/SFTCcKvUIehnsGsmZ0oifw+6OkuIY5JGuICeYc0ng6CQvUi+/GuVXAvwG1fkZsjYQQ1gkhXBfqI7aqBkdJLQohbJrV30vbCSHMDyHcFcu+Oval6mglR0LVQghbhhDuDyn6LoQ0ZteGEOaE6qPOWo1DLYSwVgjhhkJ73MaVIYRHFfrhqLGfxGfz6EFHZF0SQpiXvVNlmx1J99NCnW7/VAjhjhDCNlm78zJ6iXpzXzYMISwLgwNHcoZQHy0YQghHxDaN9ovbmpotRYfrdap46QRMmX+AfIOrUMwBLEb7wIC82T5KfyQUexy+GgUwmMtNZd+/jkTPfirmimAOs4KUojr3KjQnzVNOWyr5BFI0riJJWZZW7qE8dXRVbfbaexkp0YjbbWXjFijSbjy7X1ZWI1G7ETzomhqfW43GYHUPVyvride/XbvtWHQH8AJk7pQEE/rLHUwl/zNSGcceVwmmaE8P9ZS9Vw5BCOF3WbsnQgh7hHJu0Cv3XD8kKaIIq4PyAVRZb7tXLnWsaNC+pSGEzbIxe2uD50LQXO0Xn6tinhpdLnv30JzDnhNCGA/14+o1++8N3rmqSb0uZ/PQn7XeDiwIIfxXCGGLUBjnfispvFd7FwoLfB7VakO9R7kSKShcZ6/gvVPOfUaR/uHACso3WPG1B+J4kyTvsoVISXg+ismfiQguj+8dyO30YKQUWheN0ZLYxqchyWon5Ep7A5JSaog7LY6fn0P96bc3mxV2lyGF3PvQHG5MypK0BJnkDka6heL+fREadyvzPBY3NanXXP9epNjMPRBB47GKavUEASnCr0Gx/uej1NJQ6NMgEk5aTJ2PlCK7Ul2AggnHcci8U9UiMrL/CaVStng0gjJ4/p5qlTuub31SptRlyNyW/z9TkNe/Fikh6CpEEE2InAppLiJaoPlYznRnl0FAsa51SElMViEHLLe5CNZ+FzXjTnzaTt1e+/k2YRAuu9461a2ZQWWX9aBvj7S3j6B3hPcgmkLfTr2TRbeQx0Zfj5Jc2C48hkxJL2dwSSdnGtENVbRjJqSTh0NMe05YGuoVBuUdlrt7HoxE1F7txX73VyiV8CTJAaYX85Q9rPYm5d3OXWf/iXQGXNVmsKJnFAwHokN9fHSxjUUo8/KCmUG6vM522p5DI4+1dqCZx1vVYAWok3yUQi/IbrF2NF6tAixA4t1fEMIsoT4xQafgd/dFbp37x/sTpD12p66R1nYH4D/ivXyRTyK78bOy56uEomfUMEI7bSzz8hoG6LRNjTzWuqlrxseiE2Q3dxujXmSYJCWGaGUi8B709yjX94L4u5sBMJVcH5lyfgr8AZmCNs7aZcR3UoaR7N0R6vvkd05AKaGKWXY8WU/tor2zMAszCu3s2Y0cxf3pPBSfvBnag6+F9rlrx3dWI8WMNdqrSdpba2gPQohlxOsGTHTyMu5E2uEzEQFYXv7qNHg8Spd0OI3PextF2tsXMrh9+yzMQs/QDNmLEVfroH3sfujMsZ0Qspcd1dQu2Emlqn2MlRM5kt6AzCB/QFuIOxChAcWMPwIlMDwAcfPczFLW3lGUQOK5PDyUP7PwEIFG9u6cY+2BTus4hPqjlwxNNYAZ5MoJf1a9581jeI2Yj4zXUfE/m4JAUkgj7l0G7uPtWX2zyD4LawSUIbsRfUeUeP8I6rm8Reb8GrYMIHYZhPo00I4eWi97Nu+T9/Ct4I/VNHMWZmFwkIvxRtwppOT6LxJS2K95UKa6fkJRAml3C+H3ViNf+RuY5eyzsAZB7sbnhfspFE6ZB2WMMTyI3qv5olubp+3qP2ZwceWzMAuVgTm73Uz/G8VU2x94ULHT3YAD86tU8DWCXC+xB/BX+hvJZ2hmpejGClCUzqq2+XaSP64Ig5jHYgaYXtrbL+h0S5w7XzX1ILXteQKlYTKiD/KopnbBk7IQKdbygxqLBz9UCfYlmAO8AwXdDMrkZkVjr2ApJNdfDBvMVLtsfRmGcSkzcXcKjUzl1EIINaSt/ispK8YwcnRryV+M0g8djiwETyYFXUBCkF5dFL0ArOj7KIqeGgSiu479kf7EabHs5HMzIjytoOhyuxM6pOGxwJbI7NgMHKHlcvK4cP+fx5B/DOXs70SX4WePR85KjcyevUJA47YYHdx5BSLcK+L/pcEjAwSPw7tQFGGev8An9xRhFXJBvwv15RLkOg71OjjdiGL8t9ChBINKxtcpeAHcghbsiuy/RyL7+P5osWxT8n7uM1w0/xlyXUDuZnsX8G6UQGJQHN3bquOQorQIt1LezxzywJVXoPTUe9Jfqe1A5MnYyTi5nVciIjRIuAGl5v4aSjuWt2eQ4Do3RnPb7vHiRViCfEq+jtJiQUZ4xxCyvIjyxIHDAkb2/0GI7gwjk2jCvhavdVDc/D7I8Wc3dChBNwv8epR//nOk1NSD9pZzaGjO2UdQrHUzMKHaEB2icEj2nwlfu1wsJ5Lm4MV14naVhYq2W77dqfvF2Q25ifWRwJtRNqUvo7PglzJ4K4u30ociRF/JdKYbCp+GnHmti5zDDkAS4evReYejwOQYEoud8H9Ykd2D8c34O0+PlIf3LUWU7bfxvzkI2XeK16Pi7w1QfP268bkHkC7gFlIijItJzjcz5RbrRRmo9+xrNk+578NZKFBodfaeEalKCc7t6ma7ZCIyj968MTsBEzoTvVGks9oLRWXey2AR3vW8Kn5al5b/32zObRrPifizER4cjLa9I2PI7XPYNJI5mAj9Gu21ipOQK1dy7XxAi/wf8fpJSdle8I0SCjiX+Zrk/+6AnncjRF+FJCGDEfJitMdrFha5ivo8ZyuArdGBD+byVcExiNPmhGNebPs4KaPqKOmIqnbBz26CpL1d4m8TUVBf90JxD/uRdBX9xg2v513QXr0oYQcSgV6BtpVe7+ujY9aKJ+yA5m1z4IeoXwvGUG7vfmixq4avxc9mFLeovS5T0uUUPUfyPBqu7P81AayFnY8UeM4eA6nfy1Cqpu91WccuCNmrAiPTeRWW2QzmIOXuZxAymGiNI+bwNHQAxkkM5jBIr2cnRCkejzUCvAeNz0IU5OX1vwFyYT8EEcsNs/6Mxf5sFfvysloI4QGSODts4IYvQO67S6iW2ha11cMCXmRvQb4PXgCe/KtRdp5G770QifD51szvvgopZLuJ9Z9EXOJ31HN2l/1cFCTUzban0/Z0A7mY+1gk5jpXXq65vgNt+/qRAbcINUSArkLbTI9lvva3pbU+ZCckveZlQOrvniMMp03d4AVzJkL0Maod+BlNJtBH2IP6vnnyb0BKzjy9c6dXv7Y07eRE6PXylmUuMjV/iHpJ0Ui2NVLy5iJ0P8CE+FlMR1KP81kI0ccpz3ozgvpzLTpKqyj1elvwshHg/uzmsIEX5Snx9zC2cRhhE+q5pBfApaRF9HAeSyssT0VMJM/HbyL5hPh7ENLGq+P3HFGN9N+OnyZUxWuKpL3/HQrltt4mhz2dJtiVDhNYQXIRcDm9nd/2cIO1G9y/M34Oo9PUIMGi7T1I6et7hhra6/YTrF/ZBKVpg+lbritRhGW7nnU1lD4bEj6baGw3Ev8cZnHWXH0QCsRhV1K2C43mclhNqzMBJnj3Nvi/3/jguXgh6Ty8XAcC2nJ1YhIP6FSk0vpGkEKlW5fSfoH3GfehZJLQf67ufO0PFYQvg2El6DMJM0UAjdCvLPlvDJkCzyg82w4sbfTHCDrOdSG9ZXqtGozY3yelne5X24zc+zLY89j7AR6jYVa6DhvMxJq3UnBX5OKd29a9Nz+f7kKpGz47goz0P6a6CKsqwAh4StOnqoW/o/PYD6X/57HPwvBDP4mA13ejw0ZqyDzq75VW+iWGx7HGSSgvQ8q5KsL+moEn9RYUhHA6OtR+mN2HW8GwSGhrMvRLuvN6HgeOjPfy3ImjSHH443ivsrVvv/LfomOZhkHj7YV6CoMJzrEtdRLZKtcCvoucLap2CR0UOGpqTWz7sMAGfSo33zbuQLlt/RwUilupX0kevPDBqgrtAeyr/ABypIHBBCN4sO+NbdgF+DytAxCGFWb37O1DI4Lo0177ISUF5MloO7nB6/Bb2XOVgTnaKDoz7Txm9uAD13susgkPOs/bMjT5K1EM+GGsmfv3WTG+NRjJVzS43w8X8ty2/nzqw4XN4a9BzjGVb1/zPXoNJUvwcbQzpaUEBb3MhAjqibf//WdZs8X5WWgNy+LnINZ7bltfn3Lb+nfoE4PJ9woOsPgEM8Pd8yCP32T3BglOb2WJZxtEAIdNnJ8lPL2Dx7ChXboPUIxbz2EUufF+p/BsZZBzdi/ojyA3PUdZDQpc1zdJlG1Q0oXr2Sh+WrwKKNxxUxJBHAZY00JvhxkanQNY9dq3bf2xKItS0bZeQ4rya7NnK2+AwQt+JYp3zh3v+w3u+HLgtHhvkITGeosd4297FE6iGOHX0f8IqE4g327MQm+whPI1vn78rGr9e+38M9MlZ9fxrcKzlUKx0EnE0S9GAfODEuddx3nI3j1IxZwtEjvEy/f86aikOdTvsQYBjRbaLJJXB3+g3l3cn48k5Trsdbxz2/rL4r3ctj6G8gqeE+/1BefKKIgR/hPAjxhcto4aSTE3yMVshH4JQuhi9hpQNp+9GDx3L+ZkM/LPtC/EQwE8hudTn3PO62ErNO9OhdULeM3sh4hIviV0O36IYkH6tn0tW7i2/TmryU2kXGz9ANd1I3AB/feYy8GSy3zgrZQjs9tyQPwcJCFq5MXV7WIYiWV2cnWy0J3Uck24RhCnXUxiMpYmva17O/XZfXu58rj1fP68nk6lXrro9mq4NhotJivr7kPZZ3+NvLL6ERXmMk8maUbt2devpP1WwJmLfxXYgnIXWU/Ak+PnIE2Sjca62y3OclLWln7AEtasBJ1u5weQeL0NKRBqCngtYnafQo5evdQzH8Wt54o549l1iNHlbeoUnLZqcaMHmvn/5vv3I4EfZA2sEuFN9V6GlIPfJZ1qAfWportF/jyFj7PRTiDt++dQ3vxGvvBG9keRtjSDyDoKjVMrG1nbbYfnazekfG1HF2PfgiUoNVKzejxGn6JxfPgwgvuY62L86TX3IRQNeSW9EclNme6zYVw6A/m3GBc2o3MJ0mtzfrMHmoETHZ6LtIink5ClKoR3px6PsmB+EMXYfx959d3OdE42Sv1gFBdi8b/8YATQsUcvQRk5t6N50IvLWg+JfWui2Sv3x963w3fvR7qbRiYqSGO0d4dlDyPUCt8n0f69isw1RecsS5e2QNn6cwlC2m6cucYKn4aRdiJ7jPAOpD+NejfbqsBcez3kpnoYWmh/QkqUixB1XUDnos4c4NEoTfAhaMHbtNJJPwatBR9vcH9ll+XlOfbbeXYEuS23K830a9s1CMjjRHKwZajdfjWzoOTKN4/vRSj5paWtOWhtNkot1mkbHsxx0G4YX47wS5GXz7pUi/C5KSJPgv+ceIH2IzeiQx9uiN8Xo5h8257HkRi0IdJ87oiSBOxAvTRi0a1V+01dl5FciQcFjYhLq4VnpVKzAyCqaEcRhim9WVmbm/WjVdvbHYPidqDZ/zWkmIOE7PlWs6gwNsFt1ZaidAIw3knMrhH+Rwj5vocUGlUfBpkjYL5PH0Fhh08gZf7sFCwRWGvcDtjOei3pZM1BWgvKoFX980na9F5hS1KapFYwTC7FwwwmwveRdGGe05Uka0EZeGvRiaRRI5711gkYsf+IROLTUX7tfp3+WuS8oXAZigOT/5+bJbpdjDXg59n3QUGjCTfiFdtiieiT6BijKgJ4lsb6mrlwup5TkcTl9MaBwfier0ZrMJB0KtZOryRJOt1ufzqBVSTObEa1OvsvkI7VWomkUkjIfj/wTKScnYrv1uLz/r6SzhlOx8gOyeZ4Czo87isoHHQQyRoH7XBjiWIp3SX/6xU6nR8TuLJz7XqFXNoqq7eGLBt/7EPdD2Uo6kIm0UGMlUO33Nh7i1UoO+YSdP73mpzKqQwmkMLkc8BtDFaEr9H4nO5WBK9oregVcguEFUdGcBPEgPQmYwz2BNRWMAw6hGZtKBunXFlYWft7Eb1zTn4MslVvxkMn9tuIfjWKBBzkArb4t0f8XRzPVvvnfhAkt8FtKkpyi5G0N0g/hIcq9GWdVSV2b09yGGgHbPuuSltcNaxGhPBOZAL0vnMQbXXwxVOQP34eS+/6L42fgyKq+Tp5ZeGeCdNVDF9K8lnIoFel2gii5IejxA/tKuqKyrJcSz6TUoHbMQelln4h0sJ3K753ohS05WEVsDFy4S1KE0awn2Tv9FpvO+2ajO14H+Ls+XbNktzZWRuHRYSfhQx65ey2Vb8k/m6FqObkPwSOAH6KPLMcLOBghCptxK3A9dlneRQdprcP9c4O3YC1w+2eMFoDnof8pB9Lvag8Eb+fjzh7s0zAndTbTru2RK6wH6H8GOjFKOnIIIOYZqFDqIXQNT6Zgu9GOkyuHWQfRZKA7Ys7AAcCB6PTMTZq8J45SNEpoV0I2ac5T1GRdT5wIiJC0D2X8p51Y1Kk09pI+pmLJIe1SEhTi/d2RznrYfoZ25DOR7+C+igtg9u7N/B6erOQuA9boS3FfOr1MSYoc4B/Bb7MzKQzm4U2oRdkt+P9R5B410qE90K5C3m1LSOJiIZNgT2BZ6AFtiuweYsyy+zuOeRBMGVwAzoC6zTgwnjP+85eQkmnkL//FR2+63pzTyqP6yuQ1NEIqTwnr0Vhm1WCCXXIvteAz6BQ0FlEH3LoZc/uqLgXxd+tOIgXyLnIcSB3D/TCvhtlqzkvvrM+4vy7xmuX+HtzxGnWpjNXzoXo1JerUbDB75BN00EeJgpVLdoJpqcqbgYei7wt9k9/I5KG2kGq5bHeKpyd3A5LEo6JX40iwj7KcBwuMgstoNuF4AX3ZOAxtCcuesGcXrifB2cUF9b9aItwWeGddZDr7JYI4Tcn2X99QIL34UvRGfQLEdLc16A/UH0s9hiNbeXtwE0o5PeTqA/tcs+1e6y3GSxECsKTSLqDWYXcGgDdIru5qc+qaoXs/v96UproskVbFOuLIrj/Xxqv2ztteASLoN6/V82VLP7fjcTcZU2eNUwibrwUnfV1PSJyfrcdRDfS/Rn4ONV4Na6I9S5AUtFliGi226ZZGBLoZs9uJFkbmaW2pvWisjj5CeDf6T2vXaeKunb29sMKnYZYDgK8d5/l6GsQdMPZLbY9ByF6Oy6y/t/nt/W6cNcUpO3F3t2L1JHv/auEfklCszAA6FaMD8BRtId0JgaXIfHy4WSLzaOwBgmdJKmYhYcJdEr9jaibomyr7SZ/ACmactfPWZiFWRggdIrsRtQXIG14O4cmjCIzzXfj71mOMwuzMAPQKbIbUf+5zedNDH6PfM1nzTSzMAszBJ3s2Y2oj0YebsX8WGVgEd629aqQvehGWkV5VSv9hoGwlW2ZegnoGUS8Qu7zUFVZRY/EZs+3snzka8Um3H7pZYpJKvOUVGPZ9xGm68LyFOw1IHSD7PkxSa3cY8eQ3fjseK+qxV8lEpX5mA9jmWV15Pn0y6AqReggFY1Vtbm4+NuZj1Z1F+e134rmZuOe38+d0hoStk6Q3a6tdqRp1z32l7T2/nLjvoQCQZ7OdPORtwQB5Xr/DPKj3wc5e+RUuSh15B3Pg1/spLM9Ikp3N6jXbSyG4k42eD6gQyUWxHKNmG5f/ruYlaTsXnHcaoX7ebIIf58PfJGU73409u8VWbuLbfb7o4WytkDnlP00luETU7z4PbaNxqKoyJ3K3i/efz7S8ZwX68kz4uTjUHZ2QHE8DkWHYmyCXKRPRoee5OM7lX2+Cbllv5XkC5K3f4KUP/52lCtua5SyzMpnl5tz3ZzDNhqvYvv9+a+xH+PIovUZ5NT0YRRANh8lDfkcKc37FFrTb0IhyXcBPyCE0M41Gj+fHEKYilcrmIifR4QQaiGEsTbKPz+EsKTJcy7jglj2x0MIG7XZh1qD+08KITwQQnhuk2c6LfPFIYRlIYRHxmc6LbdZPf6+bghh7xDCLoX7/twim4crQwiXhRDODiHMaVDHSJN2HhnLOqSLdzu9vzCEcFWLd5qNp9fSUbHNt4YQfhw0x2+PbS1rPyGE+0MIFzcpe7vYvlfFNpwf65jXoNxG7Ww2XnkfPhnLvyKE8Msg3HhKCGH7eP+qEMI3Qgh/i7+fGst9Ygjh3njvT7Hvl7TL2U1p/pm0R2klwo+io4B+Sjl3KoPlpKCUXZHW/++xrPMRVxlHHP176Fhp0NZiW5Kb6SrgWejkl3+g44tujc8eAByEfLzPROmw1yVl/twGnW+3GOXW+33s7zOQRcFcezcUmLIDOr99W5St5atIr+FkHgGFtR6EjgdegPzWD0QZaw+K794L3IzO1XtxbKcTXV5IPRfbLr67I6LiH2Z66ixnOf0y8ObCOD8GcYvrYrkeW1BY7qHIvDqO5uPHwC9QXMHWSDr4e/z/ApLb8lbAvyCucmUci8XI2/Jo4Ekol98paF7mI3+N1XGsL0FxALvEvrwSrbOVcWwuIHHtZ8byxuL4XhrbaQns6PjeI2Lb1o19mULzd2B89+do3mroPLfFsV+HxD4vRtLRvvHd+ShmIyBJ1BKnsws9jRTQdTdaHy+N/R1D7uJei7ujvA6jKN7gD2jeHGT2L4ibOxXY+rHundHaOglFN26H1v0haL2eguJHdgP+guZ0/U64yrwQwi2RWkyG5rA6iPt/vUCpWlGy/w0h3Be/X1Aoc0GkWKNB1Hp5COGvQdwmhz+EEC4MotI3hhBWhhDuDCFsGkL4l/jMffHzqhDCobGtt4cQPhBCOKFQ3utCCL8LIdycjcctIYTfhBC2DYmCmro+M4RwdCzzthDCK0LijHvGMt4bfz+7UNfvQgifiN/vjO2cCiE8L743N36+Jj7zhNiO27O2mcNsEsTVzw8h7B9CeFYIYef43y8L9d4VJOGsnfXDsDCIk7m9Xy35f58QwvwQwk3xntfJb0II62T13RI0H3eFENYPIRxbKOvEIAnk4hDCY8N0OCP28bUl/3031I/R/4v3vxRC2CGktbZ/CGFF4d0j43/3hRB+EDTnIYSwdbz/qfj7sKD5uCeE8LUQwv/E+7UQwnvid0u0t4UQtgqJOxseCCE8LYTwuNiOZSGEVfG/XWN9Y7HMn8X77wtJgq0FSXMhaJ0RxOknQwjHhxDWi/99I/73oCTXjunN+5DnRCpZ3O+VgfdE32mj/CJ47ziOKO2BKGX1hsD7Y/3jiBP+FnGFSeBjJGngjSjG/hx0qMVmiDI/O5b/AsRNn48oaQ1xuZsQFZ9AVPEJiHJuS+J8NURhb0OSxUbxuV3i9Wvkg1BDsex3onFzRhxQlN5KUm7wjyNu+ybgbYiDvRn4bCznHfE9c+3fIinm47Gd30bUO5+XUcTJ9kXS1f8B747/zUVSwz/F/9ePdRyEuMbr0D79C6SDMYjjPDfeexHSrawN/BviwtvGOj6IuNTTgePjuJ+MTks9A0kNR5Cy4RwQ+/G+2I9lJL3AWSi68tPxnSej+Ip/IAnikfF5S4TmtB8BTkDc8TqUaWctxA3vi23dFGUj+m+0ppzffT71EZDbI8ljRSz7WsQx10NrdEe0/n6I1sNTkJTzH3GcJ9DBpfvEMj8MPDeO5XHx2SciCcN9AHg5ysX/EXT60TtIim9i376MpIiROFbbx3G7kaTJH6HNs96s8GrXPdYKppvQwu9WMz0HiSzOGnMdCmkFiSgXoGwse6BO3YOUMHORqW8/tACsKFkLKTH2R6LU3xFiOVPre5C4/JxY3lWkQXefrGhZicTCRwKXI6QeB66hXun0SkQknkISw42EHvuR2Pa/oa3HOBIFnxX/v4t0kICVWv9ASpmD0ATPi+PxOBLCTyJEPBt4VxzPRVmdy0m57P6OkGzLWMfvEJFaREqAaTDxPyv+vhURi13icydk9d9IWuCvjxdI7F8Z2zeG5va6rG3eKo4gMftPsd63ocW8Dhrrm0gZf/K17Dl6D0Lk4xCirBffP4N0UvDJSOm1WXwnr9uI4lNavFZOQHkZDor3tot9/zRasxfFa3fkIr6CZH6+FtgJzcurEUH9fyhI7K+I4FiZdzdaQycgwn4SSrZycSzLY7EcZXj+Syx7hHQE+Vqx/pYcOnePPZD23GO9MM6KleR2wlaQm5Fy7fko9dpwc/cxkhZ+bnxmL4Tox6PF9Lz4/1qII+6M9jbL0Z77cUzP4DqFBtHj4/qtTZ+LuMmtaMDXR5M+h6Sv8L4L6jW0k4jz+7kpUq51h46egzj9fISAr8rKCcA7Yz++jXQJRyAdRB4BaMJwO1pgf0XSiNsRSFp6j+2S+M668TmfQOIxCdn39eK798V374rlvAIhzgaIGH4qPnc82r+uh5DjVJJksxb1eQxyTf/a8f31YpuWIW66QfxdTA5S9Oi8HSH7LWifvxzNmeEJWble714Lnp852f0y/5Kl8d5u2b0t0X5/NWmOPdYjiBDuhYjhLxAyH0ji3DnOXIW4/ASSCKx7+ABav09EUqDDyK9FeqwNs/FpebCjzQ2HkNxjWyG7B8KUrBMnjLmkJBTz4ncj+FrxHvG+j0/24HlibkCL4U1IUbY3iZt+BHH2n6MJHEHbgRGUe+7wrI+5ieQM4Fgkms5DyD2KKPnhiKKej4jMixHXGUUKqlehrcQHUfqr65F4u4JEUFzf3xCRfFFs771ogX4a+BZpPh6HFuaJKDHlHsA3mE5oamirMoeEmP8Wx3IdEvEZR5z9fNL261dIZL4//j9CUoaNk5SuI4gZnIrE1g+ixbc12r68MI7HsYjbjMQ+HYg4Zo7kkHL15fOamzwnEJF+LzI1PUBCRkjI8r/I5HYRQqptkNJuW4Qk341zcFT8fh9Cjg2Q5FdD830jIqgPkMyoH0CSyIo4bn+J16fQVnLnWM87Yl/XIa2ndeN7L49j9V3Sus4lyY2Rsu02JMk9N/brO3GMRkhEcix7dwJ4C/AzhPRnIRxY0IqzewKOavFc/vxI7PjFdB7hdj1p33It9fnbrkGdBnGpG+L3B+J75lq3oVzvf0ci+Y1IPL8HiX2bopxpASHit9FecSPEef4W684XmPehG8b7VyNE/A3iqrcisftaUlrlzyLRdmukZT4ELZBN0RFJVyFueD3yQwAt7KMQEj8VUee7EMf3WNaQWHcfSWy7BllKdiLtOyeROL4ciZvPRwvGY3sxaX6vjm24Ce0t70YJQHeJ/y+OY784jvsVJP3DNYhrXof25teghbw72uIsjfX+JI7BwbHdIdZzHfXnwV2J5m5prNPSzmKSpeXDSPR+Etrvk/WbOEYXxP4dGX+/BelfPgr8F9JVHIx8EY6Oz1wWx+FPiGjfhvbTF8e6/wy8ASHbrrEf18a2vgAh1ksRor8L+H78L1/Hl8c+34PW7tsQUf0QQtDcJv9ztH6OQNaIw9FanoPW6d0kImLC7a3P0xGxOCSOza+aJa+w2PpohFxO91QUk3KwSe4DiIt2mqTCzia5A03eHkgi91T2f15P8b0yaObgY1G4mZ6h6MzRCsralHPgTsfITjN7ImJwNeKid9HeQYplY+s+z0ELeV3ErdclJSgpa2enY1F819JKsbxcSjHkY7U9Eu0PBP4TSQ6fZvp45mUU+93od7P5Krbfz4aS52rZVXQImiz53gjK+tBsnecm2AehmRjvF44gicztiv3dRrjl9vhiR/KyioOTT64XifeW/u69Vq5l9SDmg1mmhDQRmsqeMZTV5e95mXk73Acrg4p1+d1iX1xWDSnPfpG9dwPtQ9nYup6PIp0AaA//StIprq3KyrX2OSLnRNzPmVgX+5+X12ieN0CcbW78/Svg69QjlbX5zdqS603yuSmOe15uo7Uy0uC5MoQ0Bw4lzxvydeDn8/KbEdZcB/Xgu804uynSZSglskX0RmCk+S3J3bUbLXyu9R4hiWc5JWtFobu93+p/D+BUg/87gSKFbia5NHrfY5Xv9Zo926zMXJJ7dLx3BVJwdTKX1ta7b62klmZzUTbPIwjJ90TbqjtIJ8eWldWofDOuIvFtty2Q5sn/mzDk5eYuv7nyMV/LZM+UEYlO+lWUTB+ULhohuyvcGykpWiE6JM7/FuDz9J5nbhZmoRNoZ/v2sIZGCGxq47j1VlTdGtBldB/h5rY8E9kdD0Z7MZuBmukKqobchJXXfQDSLlddF0ips2f8vg/Sxub/N3rvqUjLnd+rlXx/CtJO5/eKZfveNrENNWTz3zz7v1i+wfN3BHJ6OQKZ26oCl/8cFNzyHBSwMof2JLXi95eguTwUKdWKzzUD9//pSHeyEZqH/D+QTuFEpCD9SGxz3pfi81uivm2Z/dcu+NmNSXPnejYDnlGVe+xEdCP8UagPLOjkcpDLe6Ib4Ymx7I2zdtW6LLssMGG0UG7xfh6w4HuXhnrX1E7rHsuuWnaNB7lqfjYoICeEEHZsMpZuz4Hx2SeFgmtkYUxfFJ/bOUzv42ihLXOC3Fm/EhRYEYLclF1+o367T6eFEK4Lcte8u8HYd3qNZOPw/SBX6G/Hts1tUX6tUI77flUI4fIg9+p/NBnrRuvULtCPjmX8KhtPl7NNfOaEIDfZ9xfKGC18/lN8fv+SstoZI0IIv4/tyeu5PIRwcZnCzfuz55LcY1vZ1k1Z/iejKJ1ydov8H0eebjVkXsm1y1aIzEU22k6gSP2Lio5xUhDCKMlxBlJf9kfUeg71pp52oEwZ5TaNo/3nQkSZA83PYDcV34TkLVZjuvnJsGn8dJnu+3h2z22ZE5/P29Ko/Hw83bd/Rn4INeTBloeKdgt2vFmBtomjsU0nZO1vVL7H14FBHpeDkQJyXvzf9bQLW5LW4+bIDJe3t4ZMkmuhtfQpkmu2x8rWGNf7K2T+XZSV4361WnN+blNkQs37sxlwdTMNa7vusdZc3occGXINYyfgSTgODdwtyCHii9n/GyB77evivU7i8QPJ62ouSdR5NFIqPi6W9yXUl4UoKm7DrG2PQc4tRp52xCyLaSPIhv1FJOaulz3jcc41xmUidpHo5trlgJDrBqS0+ivpdF1PusfrGGTnXYiccfJjtHJrgsu3Zvo1yD9gQfw8Liu3hsb1k8j2fCPS97wne6YT8BishezVjg+4AzmpnEUiIsV1nBPDyxHyXIPEaBO0G9HW5lSSJaMTsdnehf6et8HzsRdy974Vrek/krZcIHPhL7O6p5CP/dHZvSfG93bIym7VruIzq4GRskGaRJSgXfdYaw7PQ4unE/dYg995LXJ4+BOymc5He1nQQDwC7X/Gp5XQGNzHz6JFA3LpPD/W+XiE+BOxjt2Rv/KHEbJ8goQsr0B72GZct6z+gCbxtNj+E0nhsoZa4bMIZUTUzy5C+86PobH7ASJM3msX5/lGpET9AHIsOp56rlZsy2K0cE9BiH466dw9SPNne/c5yCd9W5ofzNkMLDlsiJxJct3N/mi/3OqIq5WIW74b+SCchfbXNke9FDlDdZNSvUwPkLd7U8T8tkdjcSViLPmzryEdn2YJ4UgSI5hC/dyL9pXdZeunBtM7aWr+AiSKtSPCmwJbhO8FXokGxRzpMOqDHEyMrBBsZ3vhLYXjw70wxxGFX0l9JN9Tsnf3QIN/THzuPpKfs7lZO4RtLnLf/SEa22MRB9weUf05Dd9MY7oFso78jHrR23A0MpUdgUTTN5A4dI7sYwgZz4m/90HRb/8Rf+dj6vJXIkK3EHnJgYI4chdN4jPfiXWDuHGN9ucqB8+bTYsed0gBTi67uG20GWspGmsQcb8CEfML4v92gfUaa2c+8wCmMjAO7Y0Iy/7Ig/KNwL6FMhYjaTM3A5b11fNY1leD2258nPZsEdm7cY8dRQv2/6h3/ugGnKjAUEML24vJfuwOG+zEtLeQ5KCwJH6uRgNe9M82/A0hp/UGDhS5t8O6JxC1/kP8PR7rXxj/W0T9Iis6qkyi8N7XIw5XXJD2k74/K9/j5P4GRKyK7b4fjYPv+1m3w9/nUT83HrMcxkihpsT/l9P5XOVwX6xrWVbG/fHeQtovdzGaX48JpP4sL32jHFqNk8FBUV47JtD5HDhhin87Ldry7N4iNI5lc9eofTnOQOxvjuymAjsjau89ZDMw5f0BKWyzm0n1ovkRUtC9B+37nC3liFjPlvHZZ6EJzwMgGoGDJ7aKz74EiU/2Q3dQySokLu1O8rx6cqzj1WjS9ozPvoZEJNpxzrG4uS8ijG9HE+ut0ng2BkYi/zYBejryxXccfI54E4ijfh6N3V3ZO4tivbXY3wUkx5dVSIzcDIm0NVKAUN6WcRQMdDTaXv0utiH3VptE+pTXIp/sxYhAPAGN+Tid6XJMfDeK3/dG6wAkXdRim2+k3rmlCJYMtonfD0USVUBRavPiuFg/0YqzjyLi+EySvsSSHlk7LollfRGJ8XvH519NIu7boG3KkfH3/JK+7keaO+dybMTZp5CeYjS+73mZD1BmUnhvkKltRZBJzdfqkmtVkMltn4IJoRuT2Eg0o5wS65uM5oolIcHqEMKioOwencKSWF4Iyi7z1/h9VQhhcVB+MWcVcbaRFfG/UPjdTg6+IhTNlxPZvdWx3HeFEF4Yv28b6k1HtwdlYxkLyv4yFpTfbzKEsFt87ishzV1en/tY1u5lIY1L3pbjQwgHxO+PjW34cEjZVaZCCCeFepPcpiGEn4aUp3BxUEahXmAiaM6XlvSnlUk4h8n4zkR2b3mon99OYGVs16OCTLJnhunmsiODMg55TvI58PpelN3zmOWZdFaGlLGoHSjizGSQqfJMe9CZi4yjSKNHtKBuOVyPpIFGfsDdwHqkPQckU0a+X+rU9JaXtQJJIhvGe6NIJBwn+Vv7ndwdtVb43QpMbUfQuF6ItgUfQxr5nUlbE4vdU6j/1g+Y21yLNOj7ZOW/lRRdd012/2CUj+0NyKJgkbKs3fm4QL2D1ATS3Syk3gz0OLT//Tja6xcluvnxc6zwXqdQnHOLvZ3Og6HM/7ybcvxuDY3NBrGM+wv/W/O/bqEu3/c9x7y7jcUgL5sa24Gy+RwFVuWKrymUbOBmFGLoPa2v4oBYqXU29Zk9egEP4AMl/x2EzF4novDBpyEE6AUWFn7nCS+rhuUofdFhSIs9iUT5+0uezSfWCp/TkNb8gyjKbSvklXUJKfT3MchH4WlIlD+HZLPtFu7Jvm+GYvSfjtbE9+L93A+bCuo07ImsPN7aHYq2EMMGxXUECclWl/xfQ7bw01Do8Y/Rmi6DU9B87txrI4v7jGtiwd1AL4o5gxUdueLH1HgRKTPnb0gOCt0G3JTV3as1oQxMqU9EiPoDxMHfjBA9TzyQt8OE01rn/0Qc9fjs2fORz0HuPLE2MuudhGLBm+1nW0Gu3Z1CHHsTpM3+PMroWhYN2Os4usxlaK5vi59WkFY151VAvm6KzG6S+rHwvI4h344bkC/J9SQzt9eC+3gZYhRmpu1agKbB/wc2m4n8qxDavQAAAABJRU5ErkJggg=='

const features = [
  { ar: 'لوحة تحكم مباشرة', en: 'Live Dashboard', icon: '📊' },
  { ar: 'تقارير PDF و Excel', en: 'PDF & Excel Reports', icon: '📄' },
  { ar: 'إدارة السلامة', en: 'Safety Management', icon: '🦺' },
  { ar: 'حساب الإيرادات تلقائياً', en: 'Auto Revenue Calc', icon: '💰' },
  { ar: 'إدارة المعدات', en: 'Equipment Mgmt', icon: '⚙️' },
  { ar: 'دعم الموبايل', en: 'Mobile Support', icon: '📱' },
]

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const setUser = useAppStore((s) => s.setUser)
  const language = useAppStore((s) => s.language)
  const setLanguage = useAppStore((s) => s.setLanguage)

  const isAr = language === 'ar'
  const isRtl = isAr

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language
      document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
    }
  }, [language, isRtl])

  const t = {
    loginTitle: isAr ? 'تسجيل الدخول' : 'Login',
    loginSubtitle: isAr ? 'أدخل بياناتك للمتابعة' : 'Enter your credentials to continue',
    email: isAr ? 'البريد الإلكتروني' : 'Email',
    password: isAr ? 'كلمة المرور' : 'Password',
    signIn: isAr ? 'دخول' : 'Sign In',
    invalidCreds: isAr ? 'بيانات الدخول غير صحيحة' : 'Invalid credentials',
    connectionError: isAr ? 'فشل الاتصال بالخادم' : 'Connection failed',
    welcomeBack: isAr ? 'مرحباً بعودتك، ' : 'Welcome back, ',
    heroTitle: isAr ? 'نظام إدارة عمليات الحفر الاحترافي' : 'Professional Pipe Jacking Management System',
    heroDesc: isAr
      ? 'منصة متكاملة لإدارة مشاريع Pipe Jacking / Microtunneling - متابعة الإنتاج اليومي، السلامة، المعدات، التكاليف والإيرادات، وتقارير الأداء من خلال لوحة تحكم مباشرة.'
      : 'Integrated platform for managing Pipe Jacking / Microtunneling projects - daily production tracking, safety, equipment, costs & revenue, and performance reports through a live dashboard.',
    copyright: isAr ? '© 2025 AXIS - جميع الحقوق محفوظة' : '© 2025 AXIS - All rights reserved',
    langBtn: isAr ? 'EN' : 'ع',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      })
      const data = await res.json()

      if (!res.ok) {
        if (data.error === 'invalidCredentials') {
          setError(isAr ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : 'Invalid email or password')
        } else if (data.error === 'database_error' || data.error === 'init_failed') {
          setError(isAr ? 'خطأ في قاعدة البيانات: ' + (data.message || 'يرجى تهيئة قاعدة البيانات') : 'Database error: ' + (data.message || 'Please initialize database'))
        } else if (data.error === 'internal_error') {
          setError(isAr ? 'خطأ داخلي: ' + (data.message || 'يرجى المحاولة مرة أخرى') : 'Internal error: ' + (data.message || 'Please try again'))
        } else {
          setError(data.message || t.invalidCreds)
        }
        return
      }

      if (data.token) {
        saveStoredToken(data.token)
      }

      setLanguage(data.user.language === 'en' ? 'en' : 'ar')
      await new Promise(resolve => setTimeout(resolve, 100))
      setUser(data.user)
      toast.success(t.welcomeBack + data.user.name)
    } catch (err) {
      setError(t.connectionError)
    } finally {
      setLoading(false)
    }
  }

  function toggleLanguage() {
    setLanguage(isAr ? 'en' : 'ar')
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="lg:flex-1 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-8 lg:p-16 flex flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-10 w-72 h-72 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-10 left-10 w-96 h-96 rounded-full bg-white blur-3xl" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <img src={AXIS_LOGO_WHITE} alt="AXIS" className="h-12 w-auto object-contain" />
          </div>
        </div>

        <div className="relative z-10 space-y-6">
          <h2 className="text-3xl lg:text-4xl font-bold leading-tight">
            {t.heroTitle}
          </h2>
          <p className="text-lg text-primary-foreground/90 leading-relaxed">
            {t.heroDesc}
          </p>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            {features.map((item) => (
              <div key={item.en} className="flex items-center gap-2 bg-white/10 backdrop-blur rounded-lg px-3 py-2">
                <span className="text-lg">{item.icon}</span>
                <span className="text-sm">{isAr ? item.ar : item.en}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-sm text-primary-foreground/70">
          {t.copyright}
        </div>
      </div>

      <div className="lg:flex-1 flex items-center justify-center p-6 lg:p-16 bg-background">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold">{t.loginTitle}</h2>
              <p className="text-muted-foreground text-sm mt-1">{t.loginSubtitle}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={toggleLanguage} className="gap-1.5">
              <Globe className="h-4 w-4" />
              <span className="text-sm font-semibold">{t.langBtn}</span>
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t.email}</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@axis.om" required className="h-11" dir="ltr" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t.password}</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="h-11" dir="ltr" />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={loading} className="w-full h-11" size="lg">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  {t.signIn}
                  <ArrowRight className={`h-4 w-4 ${isRtl ? 'mr-2 rotate-180' : 'ml-2'}`} />
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
