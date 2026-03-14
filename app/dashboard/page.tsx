'use client'

import {useEffect, useState} from 'react'
import {useRouter} from 'next/navigation'

function FormatBadge({text}: { text: string }) {
    return (
        <span className="rounded-full bg-[#e8e6ea] px-3 py-1 text-sm text-[#78757f]">
            {text}
        </span>
    )
}

function getOrCreateCid() {
    let cid = localStorage.getItem('guest_cid')
    if (cid) return cid

    cid = crypto.randomUUID() + '_' + Date.now()
    localStorage.setItem('guest_cid', cid)
    return cid
}

function makeJobId(file: File) {
    const ext = file.name.split('.').pop() || 'png'
    return `${Date.now()}_${crypto.randomUUID().replaceAll('-', '')}.${ext}`
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export default function DashboardPage() {
    const router = useRouter()

    const [uploading, setUploading] = useState(false)
    const [msg, setMsg] = useState('')
    const [originPreviewUrl, setOriginPreviewUrl] = useState('')
    const [resultUrl, setResultUrl] = useState('')
    const [progress, setProgress] = useState(0)
    const [leftCount, setLeftCount] = useState<number | null>(null)

    useEffect(() => {
        const jwt = localStorage.getItem('jwt_token')
        const rawToken = localStorage.getItem('raw_token')

        if (!jwt || !rawToken) {
            router.replace('/')
            return
        }

        fetchLeftQuota()
    }, [router])

    useEffect(() => {
        return () => {
            if (originPreviewUrl) {
                URL.revokeObjectURL(originPreviewUrl)
            }
        }
    }, [originPreviewUrl])

    async function fetchLeftQuota() {
        const jwt = localStorage.getItem('jwt_token')
        const rawToken = localStorage.getItem('raw_token')
        const cid = getOrCreateCid()

        if (!jwt || !rawToken) return
        try {
            const rsp = await fetch('/api/proxy/left_quota', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    token: rawToken,
                    Authorization: `Bearer ${jwt}`,
                    cid: cid,
                },
                body: JSON.stringify({
                    token: rawToken,
                    cid: cid,
                }),
            })

            if (!rsp.ok) {
                console.log('left_quota fail:', rsp.status, await rsp.text())
                return
            }

            const data = await rsp.json()
            console.log('left_quota:', data)

            const count = Number(data?.quota_left ?? 0)
            if (!Number.isNaN(count)) {
                setLeftCount(count)
            }
        } catch (err) {
            console.log('fetchLeftQuota error:', err)
        }
    }

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return

        const jwt = localStorage.getItem('jwt_token')
        const rawToken = localStorage.getItem('raw_token')
        const cid = getOrCreateCid()

        if (!jwt || !rawToken) {
            setMsg('请先登录')
            router.replace('/')
            return
        }

        if (leftCount !== null && leftCount <= 0) {
            setMsg('剩余次数不足,免费用户请明天再来...')
            return
        }

        setResultUrl('')
        setMsg('')
        setProgress(0)

        if (originPreviewUrl) {
            URL.revokeObjectURL(originPreviewUrl)
        }
        const localUrl = URL.createObjectURL(file)
        setOriginPreviewUrl(localUrl)

        const jobId = makeJobId(file)
        const classType = '强力模式_去除所有水印文字logo'

        try {
            setUploading(true)
            setMsg('正在申请上传地址...')
            setProgress(10)

            const uploadUrlRsp = await fetch('/api/proxy/get_upload_url', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    token: rawToken,
                    Authorization: `Bearer ${jwt}`,
                    cid: cid,
                },
                body: JSON.stringify({
                    job_id: jobId,
                    class_type: classType,
                }),
            })

            if (!uploadUrlRsp.ok) {
                const errText = await uploadUrlRsp.text()
                console.log('get_upload_url fail:', errText)
                setMsg(`获取上传地址失败：${uploadUrlRsp.status}`)
                setProgress(0)
                return
            }

            const uploadData = await uploadUrlRsp.json()
            console.log('get_upload_url:', uploadData)

            if (uploadData.state === '限速40') {
                setMsg('当前请求过多，请稍后再试')
                setProgress(0)
                return
            }

            const uploadUrl = uploadData.upload_url

            if (uploadData.state !== 'oss已存在,无需上传') {
                if (!uploadUrl) {
                    setMsg('后端没有返回 upload_url')
                    setProgress(0)
                    return
                }

                setMsg('正在上传图片...')
                setProgress(25)

                const putRsp = await fetch(uploadUrl, {
                    method: 'PUT',
                    body: file,
                })

                if (!putRsp.ok) {
                    const putText = await putRsp.text()
                    console.log('put oss fail:', putText)
                    setMsg(`上传 OSS 失败：${putRsp.status}`)
                    setProgress(0)
                    return
                }
            } else {
                setProgress(35)
            }

            setMsg('正在提交任务...')
            setProgress(45)

            const pushRsp = await fetch('/api/proxy/push_to_worker', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    token: rawToken,
                    Authorization: `Bearer ${jwt}`,
                    cid: cid,
                },
                body: JSON.stringify({
                    job_id: jobId,
                    class_type: classType,
                    left_counts: 1,
                }),
            })

            if (!pushRsp.ok) {
                const pushText = await pushRsp.text()
                console.log('push_to_worker fail:', pushText)
                setMsg(`提交任务失败：${pushRsp.status}`)
                setProgress(0)
                return
            }

            const pushData = await pushRsp.json()
            console.log('push_to_worker:', pushData)

            setMsg('图片处理中...')
            setProgress(55)

            const finalUrl = await pollResult({
                jobId,
                jwt,
                rawToken,
                cid,
            })

            if (!finalUrl) {
                setMsg('轮询超时，暂未拿到结果')
                return
            }

            setResultUrl(finalUrl)
            setProgress(100)
            setMsg('处理完成')
            await fetchLeftQuota()
        } catch (err) {
            console.log(err)
            setMsg('请求异常')
            setProgress(0)
        } finally {
            setUploading(false)
            e.target.value = ''
        }
    }

    async function pollResult({
                                  jobId,
                                  jwt,
                                  rawToken,
                                  cid,
                              }: {
        jobId: string
        jwt: string
        rawToken: string
        cid: string
    }) {
        const maxTimes = 30

        for (let i = 0; i < maxTimes; i++) {
            await sleep(2000)

            const rsp = await fetch('/api/proxy/query_job_id', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    token: rawToken,
                    Authorization: `Bearer ${jwt}`,
                    cid: cid,
                },
                body: JSON.stringify({
                    job_id_list: [jobId],
                }),
            })

            if (!rsp.ok) {
                console.log('query_job_id fail:', rsp.status, await rsp.text())
                setProgress((prev) => Math.min(prev + 2, 90))
                continue
            }

            const data = await rsp.json()
            console.log('query_job_id:', data)

            const finalUrl = data?.sign_download_url_dic?.[jobId]
            if (finalUrl) {
                setProgress(100)
                return finalUrl
            }

            const next = Math.min(55 + Math.floor(((i + 1) / maxTimes) * 40), 95)
            setProgress(next)
        }

        return ''
    }

    function handleDownload() {
        if (!resultUrl) return

        const a = document.createElement('a')
        a.href = resultUrl
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.download = ''
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
    }

    function logout() {
        localStorage.removeItem('jwt_token')
        localStorage.removeItem('raw_token')
        router.replace('/')
    }

    return (
        <main className="min-h-screen bg-[#f8efeb] text-[#2d2a32]">
            <div className="mx-auto flex min-h-screen max-w-6xl flex-col items-center px-6 py-16">
                <div className="mb-6 flex w-full max-w-[1100px] items-center justify-end gap-3">
                    <div className="rounded-lg bg-white px-4 py-2 text-sm text-slate-700 shadow">
                        剩余次数：
                        <span className="ml-1 font-bold text-[#ff6a2a]">
                            {leftCount === null ? '加载中...' : leftCount}
                        </span>
                    </div>

                    <button
                        onClick={logout}
                        className="rounded-lg bg-white px-4 py-2 text-sm text-slate-700 shadow"
                    >
                        退出登录
                    </button>
                </div>

                <h1 className="text-center text-5xl font-black tracking-tight text-black md:text-6xl">
                    全自动图片去水印
                    <span className="ml-3 inline-block text-[#ff6a2a]">✦</span>
                </h1>

                <p className="mt-8 text-center text-[18px] text-[#4b4752] md:text-[19px]">
                    行业天花板
                </p>

                <section
                    className="mt-10 w-full max-w-[480px] rounded-[28px] bg-white px-8 py-10 shadow-[0_18px_40px_rgba(219,193,177,0.18)]">
                    <div className="flex min-h-[60px] flex-col items-center justify-center">
                        <label
                            className="flex h-[86px] w-[360px] cursor-pointer items-center justify-center gap-3 rounded-[24px] border-[6px] border-[#ffd9cc] bg-gradient-to-b from-[#ff874f] to-[#ff5b19] text-[22px] font-bold text-white shadow-[0_10px_24px_rgba(255,107,43,0.22)] transition hover:scale-[1.01]">
                            <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/avif"
                                className="hidden"
                                onChange={handleFileChange}
                                disabled={uploading}
                            />
                            <span className="text-2xl">↥</span>
                            <span>{uploading ? '处理中...' : '上传图片'}</span>
                        </label>

                        {msg && (
                            <div className="mt-6 w-full max-w-[360px]">
                                <p className="mb-3 text-center text-[15px] text-[#6f6a75]">
                                    {msg}
                                </p>

                                {uploading && (
                                    <div className="w-full">
                                        <div className="mb-2 flex items-center justify-between text-sm text-[#8a8791]">
                                            <span>处理进度</span>
                                            <span>{progress}%</span>
                                        </div>

                                        <div className="h-3 w-full overflow-hidden rounded-full bg-[#f3d8cf]">
                                            <div
                                                className="h-full rounded-full bg-gradient-to-r from-[#ff874f] to-[#ff5b19] transition-all duration-500"
                                                style={{width: `${progress}%`}}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="mt-16 w-full max-w-[620px] border-t border-dashed border-[#ddd6dc]"/>

                        <div
                            className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-3 text-[15px] text-[#8a8791]">
                            <div className="flex items-center gap-2">
                                <FormatBadge text="png"/>
                                <FormatBadge text="jpg"/>
                                <FormatBadge text="webp"/>
                                <FormatBadge text="avif"/>
                            </div>
                        </div>
                    </div>
                </section>

                {(originPreviewUrl || resultUrl) && (
                    <section className="mt-10 grid w-full max-w-[1100px] grid-cols-1 gap-6 md:grid-cols-2">
                        <div className="rounded-[24px] bg-white p-6 shadow-[0_18px_40px_rgba(219,193,177,0.12)]">
                            <h2 className="mb-4 text-2xl font-bold text-black">原图</h2>
                            <div
                                className="flex min-h-[360px] items-center justify-center rounded-2xl bg-[#f6f6f8] p-4">
                                {originPreviewUrl ? (
                                    <img
                                        src={originPreviewUrl}
                                        alt="原图"
                                        className="max-h-[520px] max-w-full rounded-xl object-contain"
                                    />
                                ) : (
                                    <span className="text-[#8a8791]">暂无原图</span>
                                )}
                            </div>
                        </div>

                        <div className="rounded-[24px] bg-white p-6 shadow-[0_18px_40px_rgba(219,193,177,0.12)]">
                            <div className="mb-4 flex items-center justify-between">
                                <h2 className="text-2xl font-bold text-black">处理后</h2>

                                {resultUrl && (
                                    <button
                                        onClick={handleDownload}
                                        className="rounded-lg bg-[#ff6a2a] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                                    >
                                        下载图片
                                    </button>
                                )}
                            </div>

                            <div
                                className="flex min-h-[360px] items-center justify-center rounded-2xl bg-[#f6f6f8] p-4">
                                {resultUrl ? (
                                    <img
                                        src={resultUrl}
                                        alt="处理后"
                                        className="max-h-[520px] max-w-full rounded-xl object-contain"
                                    />
                                ) : (
                                    <span className="text-[#8a8791]">
                                        {uploading ? '处理中...' : '暂无结果'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </section>
                )}
            </div>
        </main>
    )
}